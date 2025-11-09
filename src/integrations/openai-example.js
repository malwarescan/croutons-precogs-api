/* jshint node: true, esversion: 11 */
/**
 * Example: OpenAI Function Calling with Streaming
 * 
 * This shows how to integrate Precogs with OpenAI's function calling
 * feature while maintaining streaming responses.
 * 
 * Usage: Phase 3 - Dev Tooling Integration
 */

import OpenAI from "openai";
import { invokePrecogFunction, executeInvokePrecog } from "../functions/invoke_precog.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Call OpenAI with function calling and streaming
 * 
 * @param {string} userMessage - User's message/request
 * @param {Array} conversationHistory - Previous messages in conversation
 * @returns {AsyncGenerator} Stream of response chunks
 */
export async function* callWithFunctionCalling(userMessage, conversationHistory = []) {
  const messages = [
    ...conversationHistory,
    {
      role: "user",
      content: userMessage,
    },
  ];

  const stream = await openai.chat.completions.create({
    model: "gpt-4",
    messages: messages,
    functions: [invokePrecogFunction],
    function_call: "auto", // Let model decide when to call function
    stream: true,
  });

  let functionCallName = null;
  let functionCallArguments = "";

  for await (const chunk of stream) {
    const choice = chunk.choices?.[0];
    if (!choice) continue;

    const delta = choice.delta;

    // Handle function call indication
    if (delta.function_call) {
      if (delta.function_call.name) {
        functionCallName = delta.function_call.name;
      }
      if (delta.function_call.arguments) {
        functionCallArguments += delta.function_call.arguments;
      }
    }

    // Handle regular content streaming
    if (delta.content) {
      yield {
        type: "content",
        content: delta.content,
      };
    }

    // Check if function call is complete
    if (choice.finish_reason === "function_call" && functionCallName) {
      // Parse function arguments
      let functionArgs;
      try {
        functionArgs = JSON.parse(functionCallArguments);
      } catch (e) {
        yield {
          type: "error",
          error: `Failed to parse function arguments: ${e.message}`,
        };
        return;
      }

      // Execute the function
      yield {
        type: "function_call",
        name: functionCallName,
        arguments: functionArgs,
      };

      try {
        const result = await executeInvokePrecog(functionArgs);

        // Add function result to conversation
        messages.push({
          role: "assistant",
          content: null,
          function_call: {
            name: functionCallName,
            arguments: functionCallArguments,
          },
        });

        messages.push({
          role: "function",
          name: functionCallName,
          content: JSON.stringify(result),
        });

        // Continue conversation with function result
        yield {
          type: "function_result",
          result: result,
        };

        // Optionally: Stream a follow-up response from the model
        const followUpStream = await openai.chat.completions.create({
          model: "gpt-4",
          messages: messages,
          stream: true,
        });

        for await (const followUpChunk of followUpStream) {
          const followUpDelta = followUpChunk.choices?.[0]?.delta;
          if (followUpDelta?.content) {
            yield {
              type: "content",
              content: followUpDelta.content,
            };
          }
        }
      } catch (error) {
        yield {
          type: "error",
          error: `Function execution failed: ${error.message}`,
        };
      }

      // Reset for next function call
      functionCallName = null;
      functionCallArguments = "";
    }
  }
}

/**
 * Example usage endpoint (for Phase 3)
 * 
 * POST /v1/chat
 * Body: { "message": "Run schema audit on https://example.com/service" }
 * 
 * Returns: Streaming response with function calls
 */
export async function handleChatRequest(req, res) {
  try {
    const { message, history = [] } = req.body;

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    for await (const chunk of callWithFunctionCalling(message, history)) {
      if (chunk.type === "content") {
        res.write(`data: ${JSON.stringify({ type: "content", content: chunk.content })}\n\n`);
      } else if (chunk.type === "function_call") {
        res.write(`data: ${JSON.stringify({ type: "function_call", name: chunk.name, arguments: chunk.arguments })}\n\n`);
      } else if (chunk.type === "function_result") {
        res.write(`data: ${JSON.stringify({ type: "function_result", result: chunk.result })}\n\n`);
      } else if (chunk.type === "error") {
        res.write(`data: ${JSON.stringify({ type: "error", error: chunk.error })}\n\n`);
      }
    }

    res.end();
  } catch (error) {
    console.error("[chat] Error:", error);
    res.status(500).json({ ok: false, error: error.message });
  }
}

/**
 * Example: Non-streaming function call (simpler)
 */
export async function callWithFunctionCallingSync(userMessage, conversationHistory = []) {
  const messages = [
    ...conversationHistory,
    {
      role: "user",
      content: userMessage,
    },
  ];

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: messages,
    functions: [invokePrecogFunction],
    function_call: "auto",
  });

  const message = response.choices[0].message;

  // Check if model wants to call a function
  if (message.function_call) {
    const functionName = message.function_call.name;
    const functionArgs = JSON.parse(message.function_call.arguments);

    if (functionName === "invoke_precog") {
      const result = await executeInvokePrecog(functionArgs);

      // Add function result and get model's response
      messages.push(message);
      messages.push({
        role: "function",
        name: functionName,
        content: JSON.stringify(result),
      });

      const followUp = await openai.chat.completions.create({
        model: "gpt-4",
        messages: messages,
      });

      return {
        functionCalled: true,
        functionName: functionName,
        functionArgs: functionArgs,
        functionResult: result,
        modelResponse: followUp.choices[0].message.content,
      };
    }
  }

  return {
    functionCalled: false,
    modelResponse: message.content,
  };
}

