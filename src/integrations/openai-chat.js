/* jshint node: true, esversion: 11 */
/**
 * Production-ready OpenAI function calling with streaming
 * 
 * Based on OpenAI function calling docs and community examples:
 * - Handles streaming chunks correctly
 * - Detects function calls during stream
 * - Executes functions and feeds results back
 * - Continues streaming model response
 */

import OpenAI from "openai";
import { invokePrecogFunction, executeInvokePrecog } from "../functions/invoke_precog.js";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * System prompt optimized for Precogs function calling
 */
const SYSTEM_PROMPT = `You are a helpful assistant that can invoke Precogs oracles to analyze web pages and generate insights.

When a user asks you to analyze a URL, generate schema, extract FAQs, or perform similar tasks, use the invoke_precog function.

After calling the function, always provide the stream_url or cli_url so the user can watch results in real-time.

Be concise and helpful.`;

/**
 * Call OpenAI with function calling and streaming
 * 
 * Handles the complete flow:
 * 1. Stream model response
 * 2. Detect function call requests
 * 3. Execute function when called
 * 4. Feed result back to model
 * 5. Continue streaming follow-up response
 * 
 * @param {string} userMessage - User's message/request
 * @param {Array} conversationHistory - Previous messages (optional)
 * @param {Object} options - Additional options
 * @returns {AsyncGenerator} Stream of response chunks
 */
export async function* callWithFunctionCalling(userMessage, conversationHistory = [], options = {}) {
  const {
    model = "gpt-4",
    temperature = 0.7,
    maxTokens = 2000,
  } = options;

  const messages = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    ...conversationHistory,
    {
      role: "user",
      content: userMessage,
    },
  ];

  try {
    const stream = await openai.chat.completions.create({
      model: model,
      messages: messages,
      functions: [invokePrecogFunction],
      function_call: "auto", // Let model decide when to call function
      stream: true,
      temperature: temperature,
      max_tokens: maxTokens,
    });

    let functionCallName = null;
    let functionCallArguments = "";
    let accumulatedContent = "";

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;

      const delta = choice.delta;

      // Handle function call chunks
      if (delta.function_call) {
        if (delta.function_call.name) {
          functionCallName = delta.function_call.name;
          yield {
            type: "function_call_start",
            name: functionCallName,
          };
        }
        if (delta.function_call.arguments) {
          functionCallArguments += delta.function_call.arguments;
        }
      }

      // Handle regular content streaming
      if (delta.content) {
        accumulatedContent += delta.content;
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
            raw: functionCallArguments,
          };
          return;
        }

        // Yield function call event
        yield {
          type: "function_call",
          name: functionCallName,
          arguments: functionArgs,
        };

        // Execute the function
        try {
          const functionResult = await executeInvokePrecog(
            functionArgs,
            process.env.PRECOGS_BASE_URL || "https://precogs.croutons.ai"
          );

          // Add function call and result to conversation
          messages.push({
            role: "assistant",
            content: accumulatedContent || null,
            function_call: {
              name: functionCallName,
              arguments: functionCallArguments,
            },
          });

          messages.push({
            role: "function",
            name: functionCallName,
            content: JSON.stringify(functionResult),
          });

          // Yield function result
          yield {
            type: "function_result",
            result: functionResult,
          };

          // Continue conversation with function result
          // Stream follow-up response from model
          const followUpStream = await openai.chat.completions.create({
            model: model,
            messages: messages,
            stream: true,
            temperature: temperature,
            max_tokens: maxTokens,
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
        } catch (functionError) {
          yield {
            type: "error",
            error: `Function execution failed: ${functionError.message}`,
            function: functionCallName,
            arguments: functionArgs,
          };
        }

        // Reset for potential next function call
        functionCallName = null;
        functionCallArguments = "";
        accumulatedContent = "";
      }

      // Handle normal completion
      if (choice.finish_reason === "stop") {
        yield {
          type: "complete",
        };
      }
    }
  } catch (error) {
    yield {
      type: "error",
      error: error.message || String(error),
    };
  }
}

/**
 * Non-streaming version (simpler, for testing)
 * 
 * @param {string} userMessage - User's message
 * @param {Array} conversationHistory - Previous messages
 * @returns {Promise<Object>} Complete response
 */
export async function callWithFunctionCallingSync(userMessage, conversationHistory = []) {
  const messages = [
    {
      role: "system",
      content: SYSTEM_PROMPT,
    },
    ...conversationHistory,
    {
      role: "user",
      content: userMessage,
    },
  ];

  try {
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
        // Execute function
        const functionResult = await executeInvokePrecog(
          functionArgs,
          process.env.PRECOGS_BASE_URL || "https://precogs.croutons.ai"
        );

        // Add function call and result to conversation
        messages.push(message);
        messages.push({
          role: "function",
          name: functionName,
          content: JSON.stringify(functionResult),
        });

        // Get model's follow-up response
        const followUp = await openai.chat.completions.create({
          model: "gpt-4",
          messages: messages,
        });

        return {
          functionCalled: true,
          functionName: functionName,
          functionArgs: functionArgs,
          functionResult: functionResult,
          modelResponse: followUp.choices[0].message.content,
          messages: messages, // For continuing conversation
        };
      }
    }

    return {
      functionCalled: false,
      modelResponse: message.content,
      messages: messages,
    };
  } catch (error) {
    throw new Error(`OpenAI API error: ${error.message}`);
  }
}

