// src/routes/ingest.js
// Universal "Intended User" Shaping + Citation Magnet Upgrade
// SINR-aligned retrieval substrate with deterministic truth substrate

import crypto from 'crypto';
import { pool } from '../db.js';

// Generate deterministic ID from components
function generateId(...components) {
  const combined = components.join('|');
  return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 16);
}

// Extract JSON-LD structured data from HTML
function extractJSONLD(html) {
  const schemas = [];
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
  let match;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      schemas.push(parsed);
    } catch (e) {
      // Skip invalid JSON
    }
  }
  return schemas;
}

// Extract meta tags for LLM context
function extractMetaTags(html) {
  const meta = {
    description: '',
    keywords: '',
    author: '',
    og: {},
    twitter: {}
  };

  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (descMatch) meta.description = descMatch[1].trim();

  const keywordsMatch = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']+)["']/i);
  if (keywordsMatch) meta.keywords = keywordsMatch[1].trim();

  const authorMatch = html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i);
  if (authorMatch) meta.author = authorMatch[1].trim();

  const ogRegex = /<meta[^>]*property=["']og:(\w+)["'][^>]*content=["']([^"']+)["']/gi;
  let ogMatch;
  while ((ogMatch = ogRegex.exec(html)) !== null) {
    meta.og[ogMatch[1]] = ogMatch[2].trim();
  }

  const twitterRegex = /<meta[^>]*name=["']twitter:(\w+)["'][^>]*content=["']([^"']+)["']/gi;
  let twitterMatch;
  while ((twitterMatch = twitterRegex.exec(html)) !== null) {
    meta.twitter[twitterMatch[1]] = twitterMatch[2].trim();
  }

  return meta;
}

// Extract links for boilerplate detection
function extractLinkTexts(html) {
  const linkTexts = new Set();
  const linkRegex = /<a[^>]*>(.*?)<\/a>/gi;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(html)) !== null) {
    const text = linkMatch[1].replace(/<[^>]*>/g, '').trim();
    if (text && text.length < 100) {
      linkTexts.add(text.toLowerCase());
    }
  }
  return linkTexts;
}

// Hard boilerplate + CTA scrubbing (REQUIREMENT 2)
function removeBoilerplateHard(text, linkTexts, boilerplateSignals) {
  if (!text) return '';
  
  const removedFragments = [];
  const rulesFired = [];
  
  // CTA patterns (case-insensitive)
  const ctaPatterns = [
    /(?:^|\n)(book consultation|view services|learn about|start learning|get started|contact|schedule|request a quote|free consultation)/i,
    /(?:^|\n)(book|learn|start|get|view|contact|schedule|request|free)\s+(?:consultation|services|learning|started|contact|schedule|quote)/i
  ];
  
  // Remove trailing CTA clusters (3+ short title-case phrases)
  const ctaClusterPattern = /(?:\n[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}){3,}$/;
  
  let cleaned = text;
  
  // Remove CTA patterns
  for (const pattern of ctaPatterns) {
    const matches = cleaned.match(pattern);
    if (matches) {
      cleaned = cleaned.replace(pattern, '');
      removedFragments.push(...matches.filter(Boolean));
      rulesFired.push('cta_pattern');
    }
  }
  
  // Remove CTA clusters
  if (ctaClusterPattern.test(cleaned)) {
    cleaned = cleaned.replace(ctaClusterPattern, '');
    rulesFired.push('cta_cluster');
  }
  
  // Remove nav-label sequences matching link anchor text
  const lines = cleaned.split('\n').map(line => line.trim()).filter(line => {
    if (!line) return false;
    
    // Drop lines shorter than 60 chars if in boilerplate set
    if (line.length < 60 && linkTexts.has(line.toLowerCase())) {
      removedFragments.push(line);
      return false;
    }
    
    // Drop lines matching link text exactly
    if (linkTexts.has(line.toLowerCase())) {
      removedFragments.push(line);
      return false;
    }
    
    // Remove lines that are just punctuation
    if (/^[^\w\s]+$/.test(line)) {
      return false;
    }
    
    return true;
  });
  
  cleaned = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  
  boilerplateSignals.removed_fragments.push(...removedFragments);
  boilerplateSignals.rules_fired.push(...new Set(rulesFired));
  
  return cleaned;
}

// Extract sections from HTML using heading hierarchy
function extractSections(html, url, docId, boilerplateSignals) {
  const sections = [];
  
  // Extract all headings with their positions
  const headingRegex = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
  const headings = [];
  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    headings.push({
      level: parseInt(match[1]),
      text: match[2].replace(/<[^>]*>/g, '').trim(),
      position: match.index,
      fullMatch: match[0]
    });
  }
  
  if (headings.length === 0) {
    // No headings, create one section from body
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      const linkTexts = extractLinkTexts(bodyMatch[1]);
      let cleanText = bodyMatch[1]
        .replace(/<script[^>]*>.*?<\/script>/gis, '')
        .replace(/<style[^>]*>.*?<\/style>/gis, '')
        .replace(/<nav[^>]*>.*?<\/nav>/gis, '')
        .replace(/<footer[^>]*>.*?<\/footer>/gis, '')
        .replace(/<aside[^>]*>.*?<\/aside>/gis, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      
      cleanText = removeBoilerplateHard(cleanText, linkTexts, boilerplateSignals);
      
      if (cleanText.length > 100) {
        sections.push({
          section_id: generateId(url, 'section', 0),
          doc_id: docId,
          url,
          section_path: 'Document',
          heading_text: '',
          heading_level: 0,
          char_start: 0, // Will be set when building doc_clean_text
          char_end: 0,
          clean_text: cleanText,
          prev_section_id: null,
          next_section_id: null
        });
      }
    }
    return sections;
  }
  
  // Build section path hierarchy
  const pathStack = [];
  
  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i];
    const nextHeading = headings[i + 1];
    
    // Update path stack based on heading level
    while (pathStack.length > 0 && pathStack[pathStack.length - 1].level >= heading.level) {
      pathStack.pop();
    }
    pathStack.push({ level: heading.level, text: heading.text });
    
    const sectionPath = pathStack.map(h => h.text).join(' > ');
    
    // Find text between this heading and next (or end)
    const startPos = heading.position + heading.fullMatch.length;
    const endPos = nextHeading ? nextHeading.position : html.length;
    const sectionHtml = html.substring(startPos, endPos);
    
    // Clean and extract text
    let cleanText = sectionHtml
      .replace(/<script[^>]*>.*?<\/script>/gis, '')
      .replace(/<style[^>]*>.*?<\/style>/gis, '')
      .replace(/<nav[^>]*>.*?<\/nav>/gis, '')
      .replace(/<footer[^>]*>.*?<\/footer>/gis, '')
      .replace(/<aside[^>]*>.*?<\/aside>/gis, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    // Remove boilerplate with hard scrubbing
    const linkTexts = extractLinkTexts(sectionHtml);
    cleanText = removeBoilerplateHard(cleanText, linkTexts, boilerplateSignals);
    
    if (cleanText.length < 100) continue; // Skip very short sections
    
    // Split long sections into windows (600-1000 tokens ≈ 2400-4000 chars)
    const maxSectionLength = 3000;
    let windowIndex = 0;
    let remainingText = cleanText;
    
    while (remainingText.length > 0) {
      const windowText = remainingText.substring(0, maxSectionLength);
      const sectionId = generateId(url, sectionPath, windowIndex);
      
      sections.push({
        section_id: sectionId,
        doc_id: docId,
        url,
        section_path: sectionPath,
        heading_text: heading.text,
        heading_level: heading.level,
        char_start: 0, // Will be set when building doc_clean_text
        char_end: 0,
        clean_text: windowText,
        prev_section_id: i > 0 ? sections[sections.length - 1]?.section_id : null,
        next_section_id: null // Will be set in next iteration
      });
      
      // Set prev section's next pointer
      if (sections.length > 1) {
        sections[sections.length - 2].next_section_id = sectionId;
      }
      
      remainingText = remainingText.substring(maxSectionLength);
      windowIndex++;
    }
  }
  
  return sections;
}

// REQUIREMENT 1: Build doc_clean_text and fix provenance offsets
function buildDocCleanText(sections) {
  if (!sections || sections.length === 0) {
    return '';
  }
  
  const docParts = [];
  let cursor = 0;
  
  for (const section of sections) {
    if (!section || !section.clean_text) continue;
    
    const sectionStart = cursor;
    docParts.push(section.clean_text);
    const sectionEnd = cursor + section.clean_text.length;
    
    // Set absolute offsets
    section.char_start = sectionStart;
    section.char_end = sectionEnd;
    
    cursor = sectionEnd + 5; // Add separator length "\n\n—\n\n"
    if (cursor < docParts.join('\n\n—\n\n').length) {
      cursor = docParts.join('\n\n—\n\n').length;
    }
  }
  
  return docParts.join('\n\n—\n\n');
}

// REQUIREMENT 3: Atomize units (one claim per unit, 120-350 chars target, 800 hard cap)
function atomizeUnit(text, unitType, maxLength = 800) {
  if (text.length <= maxLength) {
    return [text];
  }
  
  const units = [];
  
  // Split by colon-chains first (e.g., "Research-based approach: ... Entity engineering: ...")
  const colonSplit = text.split(/:\s*(?=[A-Z])/);
  if (colonSplit.length > 1) {
    for (let i = 0; i < colonSplit.length; i++) {
      let part = colonSplit[i].trim();
      if (i < colonSplit.length - 1) {
        part += ':';
      }
      if (part.length > maxLength) {
        // Further split by sentences
        const sentences = part.split(/(?<=[.!?])\s+/);
        let current = '';
        for (const sentence of sentences) {
          if ((current + ' ' + sentence).length > maxLength && current) {
            units.push(current.trim());
            current = sentence;
          } else {
            current = current ? current + ' ' + sentence : sentence;
          }
        }
        if (current) units.push(current.trim());
      } else if (part.length > 50) {
        units.push(part);
      }
    }
  } else {
    // Split by sentences
    const sentences = text.split(/(?<=[.!?])\s+/);
    let current = '';
    for (const sentence of sentences) {
      if ((current + ' ' + sentence).length > maxLength && current) {
        units.push(current.trim());
        current = sentence;
      } else {
        current = current ? current + ' ' + sentence : sentence;
      }
    }
    if (current) units.push(current.trim());
  }
  
  return units.filter(u => u.length >= 50); // Minimum unit size
}

// REQUIREMENT 4: Extract canonical definitions as first-class units
function extractDefinitionUnits(sections, docId, url, docCleanText) {
  const units = [];
  
  // Multiple definition patterns
  const definitionPatterns = [
    /^([A-Z][A-Z\s]+)\s*\(([^)]+)\)\s*[:\-]\s*(.+?)(?=\n\n|\n[A-Z]|$)/gms, // TERM (Expansion): definition
    /^([A-Z][A-Z\s]+)\s+is\s+(.+?)(?=\.\s+[A-Z]|\.$|$)/gms, // TERM is definition
    /^([A-Z][A-Z\s]+)\s*:\s*(.+?)(?=\n\n|\n[A-Z]|$)/gms // TERM: definition
  ];
  
  for (const section of sections) {
    for (const pattern of definitionPatterns) {
      let match;
      while ((match = pattern.exec(section.clean_text)) !== null) {
        const term = match[1].trim();
        const expansion = match[2]?.trim() || '';
        const definition = (match[3] || match[2] || '').trim();
        
        if (term && definition && definition.length > 30) {
          // Atomize if needed
          const definitionParts = atomizeUnit(definition, 'definition', 350);
          
          for (const part of definitionParts) {
            const fullText = expansion ? `${term} (${expansion}): ${part}` : `${term}: ${part}`;
            
            // Find char offsets in doc_clean_text
            const sectionStart = section.char_start;
            const localOffset = section.clean_text.indexOf(match[0]);
            const charStart = sectionStart + localOffset;
            const charEnd = charStart + fullText.length;
            
            const unitId = generateId(url, 'definition', term, part.substring(0, 50));
            const entityRefs = [term, expansion].filter(Boolean);
            
            units.push({
              unit_id: unitId,
              section_id: section.section_id,
              doc_id: docId,
              url,
              unit_type: 'definition',
              clean_text: fullText,
              char_start: charStart,
              char_end: charEnd,
              enriched_text_for_embedding: `DOC: ${section.section_path} | URL: ${url} | TYPE: definition | TEXT: ${fullText}`,
              entity_refs: entityRefs
            });
          }
        }
      }
    }
  }
  
  return units;
}

// REQUIREMENT 5: Normalize schema facts into triples
function normalizeSchemaFacts(schemas, sections, docId, url, docCleanText) {
  const entities = [];
  const units = [];
  
  for (const schema of schemas) {
    const items = Array.isArray(schema['@graph']) ? schema['@graph'] : [schema];
    
    for (const item of items) {
      const itemType = Array.isArray(item['@type']) ? item['@type'][0] : item['@type'];
      const itemId = item['@id'] || generateId(url, itemType, item.name || '');
      
      // Create entity node
      entities.push({
        entity_id: itemId,
        entity_type: itemType,
        name: item.name || '',
        url: item.url || url
      });
      
      // Extract facts as triples
      if (!sections || sections.length === 0) continue;
      const firstSection = sections[0];
      
      // Name
      if (item.name) {
        const factText = `${item.name} (${itemType}) name is ${item.name}.`;
        const unitId = generateId(url, 'fact', itemType, 'name', item.name);
        units.push({
          unit_id: unitId,
          section_id: firstSection.section_id,
          doc_id: docId,
          url,
          unit_type: 'fact',
          clean_text: factText,
          char_start: firstSection.char_start,
          char_end: firstSection.char_start + factText.length,
          enriched_text_for_embedding: `DOC: ${firstSection.section_path} | URL: ${url} | TYPE: fact | TEXT: ${factText}`,
          entity_refs: [item.name],
          triple: {
            subject_id: itemId,
            subject_type: itemType,
            predicate: 'name',
            object: item.name,
            source_jsonld_ref: item['@id'] || ''
          }
        });
      }
      
      // Telephone
      if (item.telephone) {
        const factText = `${item.name || itemType} telephone is ${item.telephone}.`;
        const unitId = generateId(url, 'fact', itemType, 'telephone');
        units.push({
          unit_id: unitId,
          section_id: firstSection.section_id,
          doc_id: docId,
          url,
          unit_type: 'fact',
          clean_text: factText,
          char_start: firstSection.char_start,
          char_end: firstSection.char_start + factText.length,
          enriched_text_for_embedding: `DOC: ${firstSection.section_path} | URL: ${url} | TYPE: fact | TEXT: ${factText}`,
          entity_refs: [item.name].filter(Boolean),
          triple: {
            subject_id: itemId,
            subject_type: itemType,
            predicate: 'telephone',
            object: item.telephone,
            source_jsonld_ref: item['@id'] || ''
          }
        });
      }
      
      // Founder
      if (item.founder) {
        const founderName = typeof item.founder === 'string' ? item.founder : (item.founder.name || '');
        if (founderName) {
          const factText = `${item.name || itemType} founder is ${founderName}.`;
          const unitId = generateId(url, 'fact', itemType, 'founder');
          units.push({
            unit_id: unitId,
            section_id: firstSection.section_id,
            doc_id: docId,
            url,
            unit_type: 'fact',
            clean_text: factText,
            char_start: firstSection.char_start,
            char_end: firstSection.char_start + factText.length,
            enriched_text_for_embedding: `DOC: ${firstSection.section_path} | URL: ${url} | TYPE: fact | TEXT: ${factText}`,
            entity_refs: [item.name, founderName].filter(Boolean),
            triple: {
              subject_id: itemId,
              subject_type: itemType,
              predicate: 'founder',
              object: founderName,
              source_jsonld_ref: item['@id'] || ''
            }
          });
        }
      }
      
      // SameAs
      if (item.sameAs && Array.isArray(item.sameAs)) {
        for (const sameAsUrl of item.sameAs) {
          const factText = `${item.name || itemType} sameAs includes ${sameAsUrl}.`;
          const unitId = generateId(url, 'fact', itemType, 'sameAs', sameAsUrl);
          units.push({
            unit_id: unitId,
            section_id: firstSection.section_id,
            doc_id: docId,
            url,
            unit_type: 'fact',
            clean_text: factText,
            char_start: firstSection.char_start,
            char_end: firstSection.char_start + factText.length,
            enriched_text_for_embedding: `DOC: ${firstSection.section_path} | URL: ${url} | TYPE: fact | TEXT: ${factText}`,
            entity_refs: [item.name].filter(Boolean),
            triple: {
              subject_id: itemId,
              subject_type: itemType,
              predicate: 'sameAs',
              object: sameAsUrl,
              source_jsonld_ref: item['@id'] || ''
            }
          });
        }
      }
    }
  }
  
  return { entities, units };
}

// REQUIREMENT 6: Add assertion frames (lowest inference format)
function createAssertionFrame(unit, section, url, contentHash) {
  const assertion = {
    subject: (unit.entity_refs && unit.entity_refs.length > 0) ? unit.entity_refs[0] : '',
    predicate: '',
    object: '',
    qualifiers: [],
    modality: 'is',
    scope: section?.section_path || '',
    provenance: {
      url,
      section_id: section?.section_id || '',
      char_start: unit.char_start || 0,
      char_end: unit.char_end || 0,
      content_hash: contentHash
    }
  };
  
  // Extract predicate/object based on unit type
  if (unit.unit_type === 'definition') {
    const match = unit.clean_text.match(/^([^:]+):\s*(.+)$/);
    if (match) {
      assertion.subject = match[1].trim();
      assertion.predicate = 'is defined as';
      assertion.object = match[2].trim();
      assertion.modality = 'is';
    }
  } else if (unit.unit_type === 'fact' && unit.triple) {
    assertion.subject = unit.triple.subject_id;
    assertion.predicate = unit.triple.predicate;
    assertion.object = unit.triple.object;
    assertion.modality = 'is';
  } else if (unit.unit_type === 'faq_q') {
    assertion.predicate = 'asks';
    assertion.object = unit.clean_text;
    assertion.modality = 'is';
  } else if (unit.unit_type === 'faq_a') {
    assertion.predicate = 'answers';
    assertion.object = unit.clean_text;
    assertion.modality = 'is';
  } else if (unit.unit_type === 'claim') {
    // Try to extract subject-predicate-object from claim
    const claimMatch = unit.clean_text.match(/^([^,]+?)\s+(?:is|are|do not|fundamentally|prioritize|evaluate|extract)\s+(.+)$/i);
    if (claimMatch) {
      assertion.subject = claimMatch[1].trim();
      assertion.predicate = 'asserts';
      assertion.object = claimMatch[2].trim();
      assertion.modality = 'claims';
    } else {
      assertion.predicate = 'asserts';
      assertion.object = unit.clean_text;
      assertion.modality = 'claims';
    }
  }
  
  return assertion;
}

// Extract FAQ units from JSON-LD FAQPage schema
function extractFAQUnits(schemas, sections, docId, url, docCleanText, contentHash) {
  const units = [];
  const edges = [];
  
  for (const schema of schemas) {
    const items = Array.isArray(schema['@graph']) ? schema['@graph'] : [schema];
    
    for (const item of items) {
      if (item['@type'] === 'FAQPage' && Array.isArray(item.mainEntity)) {
        for (const faq of item.mainEntity) {
          if (faq['@type'] === 'Question' && faq.acceptedAnswer) {
            const questionText = faq.name || faq.text || '';
            const answerText = faq.acceptedAnswer.text || '';
            
            if (questionText && answerText) {
              // Atomize answer if needed
              const answerParts = atomizeUnit(answerText, 'faq_a', 350);
              
              // Find best matching section
              const faqSection = sections && sections.length > 0 ? (
                sections.find(s => 
                  s.heading_text && (
                    s.heading_text.toLowerCase().includes('question') ||
                    s.heading_text.toLowerCase().includes('faq')
                  )
                ) || sections[0]
              ) : null;
              
              if (faqSection) {
                const qId = generateId(url, 'faq_q', questionText);
                
                // Create question unit
                const qCharStart = faqSection.char_start;
                const qCharEnd = qCharStart + questionText.length;
                
                units.push({
                  unit_id: qId,
                  section_id: faqSection.section_id,
                  doc_id: docId,
                  url,
                  unit_type: 'faq_q',
                  clean_text: questionText,
                  char_start: qCharStart,
                  char_end: qCharEnd,
                  enriched_text_for_embedding: `DOC: ${faqSection.section_path} | URL: ${url} | TYPE: faq_q | TEXT: ${questionText}`,
                  entity_refs: [],
                  assertion: createAssertionFrame({
                    unit_type: 'faq_q',
                    clean_text: questionText,
                    char_start: qCharStart,
                    char_end: qCharEnd
                  }, faqSection, url, contentHash)
                });
                
                // Create answer units (atomized)
                let answerCharStart = qCharEnd + 1;
                for (const answerPart of answerParts) {
                  const aId = generateId(url, 'faq_a', answerText, answerPart.substring(0, 50));
                  const answerCharEnd = answerCharStart + answerPart.length;
                  
                  units.push({
                    unit_id: aId,
                    section_id: faqSection.section_id,
                    doc_id: docId,
                    url,
                    unit_type: 'faq_a',
                    clean_text: answerPart,
                    char_start: answerCharStart,
                    char_end: answerCharEnd,
                    enriched_text_for_embedding: `DOC: ${faqSection.section_path} | URL: ${url} | TYPE: faq_a | TEXT: ${answerPart}`,
                    entity_refs: [],
                    assertion: createAssertionFrame({
                      unit_type: 'faq_a',
                      clean_text: answerPart,
                      char_start: answerCharStart,
                      char_end: answerCharEnd
                    }, faqSection, url, contentHash)
                  });
                  
                  // Create answer edge
                  edges.push({
                    from_unit_id: qId,
                    to_unit_id: aId,
                    edge_type: 'answers',
                    edge_label: 'answers',
                    confidence: 0.99
                  });
                  
                  answerCharStart = answerCharEnd + 1;
                }
              }
            }
          }
        }
      }
    }
  }
  
  return { units, edges };
}

// Extract claim units (atomized)
function extractClaimUnits(sections, docId, url, docCleanText) {
  const units = [];
  
  const claimPatterns = [
    /(?:AI systems|Generative AI|ChatGPT|Google AI Overviews)\s+(?:do not|fundamentally|prioritize|evaluate|extract)/gi,
    /(?:Traditional SEO|Indexing and retrieval)\s+(?:are|is|optimizes|measures)/gi
  ];
  
  for (const section of sections) {
    const sentences = section.clean_text.split(/(?<=[.!?])\s+/).filter(s => s.length > 50);
    
    for (const sentence of sentences) {
      if (claimPatterns.some(pattern => pattern.test(sentence))) {
        // Atomize if needed
        const claimParts = atomizeUnit(sentence, 'claim', 350);
        
        let charStart = section.char_start + section.clean_text.indexOf(sentence);
        for (const claimPart of claimParts) {
          const unitId = generateId(url, 'claim', claimPart.substring(0, 50));
          const charEnd = charStart + claimPart.length;
          
          units.push({
            unit_id: unitId,
            section_id: section.section_id,
            doc_id: docId,
            url,
            unit_type: 'claim',
            clean_text: claimPart,
            char_start: charStart,
            char_end: charEnd,
            enriched_text_for_embedding: `DOC: ${section.section_path} | URL: ${url} | TYPE: claim | TEXT: ${claimPart}`,
            entity_refs: []
          });
          
          charStart = charEnd + 1;
        }
      }
    }
  }
  
  return units;
}

// REQUIREMENT 9: Edge expansion beyond FAQ
function generateExpandedEdges(units, sections) {
  const edges = [];
  
  const faqQuestions = units.filter(u => u.unit_type === 'faq_q');
  const definitions = units.filter(u => u.unit_type === 'definition');
  const claims = units.filter(u => u.unit_type === 'claim');
  const facts = units.filter(u => u.unit_type === 'fact');
  const faqAnswers = units.filter(u => u.unit_type === 'faq_a');
  
  // FAQ Q -> Definition (elaborates)
  for (const faq of faqQuestions) {
    const questionLower = faq.clean_text.toLowerCase();
    for (const def of definitions) {
      const defTerms = def.entity_refs.map(e => e.toLowerCase());
      if (defTerms.some(term => questionLower.includes(term))) {
        edges.push({
          from_unit_id: faq.unit_id,
          to_unit_id: def.unit_id,
          edge_type: 'elaborates',
          edge_label: 'elaborates',
          confidence: 0.85
        });
      }
    }
  }
  
  // FAQ A -> Definition (supports)
  for (const answer of faqAnswers) {
    const answerLower = answer.clean_text.toLowerCase();
    for (const def of definitions) {
      const defTerms = def.entity_refs.map(e => e.toLowerCase());
      if (defTerms.some(term => answerLower.includes(term))) {
        edges.push({
          from_unit_id: answer.unit_id,
          to_unit_id: def.unit_id,
          edge_type: 'supports',
          edge_label: 'supports',
          confidence: 0.80
        });
      }
    }
  }
  
  // Claim -> Definition (defines)
  for (const claim of claims) {
    const claimLower = claim.clean_text.toLowerCase();
    for (const def of definitions) {
      const defTerms = def.entity_refs.map(e => e.toLowerCase());
      if (defTerms.some(term => claimLower.includes(term))) {
        edges.push({
          from_unit_id: claim.unit_id,
          to_unit_id: def.unit_id,
          edge_type: 'defines',
          edge_label: 'defines',
          confidence: 0.75
        });
      }
    }
  }
  
  // Claim -> Fact (supported_by)
  for (const claim of claims) {
    const claimLower = claim.clean_text.toLowerCase();
    for (const fact of facts) {
      if (fact.entity_refs.some(entity => claimLower.includes(entity.toLowerCase()))) {
        edges.push({
          from_unit_id: claim.unit_id,
          to_unit_id: fact.unit_id,
          edge_type: 'supported_by',
          edge_label: 'supported_by',
          confidence: 0.70
        });
      }
    }
  }
  
  // Definition -> Section (located_in)
  for (const def of definitions) {
    const section = sections.find(s => s.section_id === def.section_id);
    if (section) {
      edges.push({
        from_unit_id: def.unit_id,
        to_unit_id: section.section_id, // Using section_id as target
        edge_type: 'located_in',
        edge_label: 'located_in',
        confidence: 1.0
      });
    }
  }
  
  return edges;
}

// REQUIREMENT 7: Intended user inference
function inferIntendedUsers(schemas, sections, units) {
  const signals = [];
  const userScores = {
    buyer_view: 0,
    patient_view: 0,
    developer_view: 0,
    support_view: 0,
    local_service_view: 0,
    research_view: 0
  };
  
  // Schema signals (highest weight)
  for (const schema of schemas) {
    const items = Array.isArray(schema['@graph']) ? schema['@graph'] : [schema];
    for (const item of items) {
      const itemType = Array.isArray(item['@type']) ? item['@type'][0] : item['@type'];
      
      if (['Product', 'Offer', 'Review', 'AggregateRating'].includes(itemType)) {
        userScores.buyer_view += 3;
        signals.push({ type: 'schema', signal: itemType, user: 'buyer_view' });
      }
      if (itemType && itemType.startsWith('Medical')) {
        userScores.patient_view += 3;
        signals.push({ type: 'schema', signal: itemType, user: 'patient_view' });
      }
      if (['APIReference', 'TechArticle', 'SoftwareApplication'].includes(itemType)) {
        userScores.developer_view += 3;
        signals.push({ type: 'schema', signal: itemType, user: 'developer_view' });
      }
      if (['FAQPage', 'HowTo'].includes(itemType)) {
        userScores.support_view += 3;
        signals.push({ type: 'schema', signal: itemType, user: 'support_view' });
      }
      if (['LocalBusiness', 'Service'].includes(itemType) && item.areaServed) {
        userScores.local_service_view += 3;
        signals.push({ type: 'schema', signal: itemType, user: 'local_service_view' });
      }
      if (['ScholarlyArticle', 'Report'].includes(itemType)) {
        userScores.research_view += 3;
        signals.push({ type: 'schema', signal: itemType, user: 'research_view' });
      }
    }
  }
  
  // Content signals
  const allText = sections.map(s => s.clean_text).join(' ').toLowerCase();
  
  if (/(?:pricing|payment|quote|booking|purchase|buy|order)/.test(allText)) {
    userScores.buyer_view += 1;
    userScores.local_service_view += 1;
    signals.push({ type: 'content', signal: 'pricing/payment terms', user: 'buyer_view' });
  }
  
  if (/(?:code|endpoint|api|auth|token|function|class|import)/.test(allText)) {
    userScores.developer_view += 2;
    signals.push({ type: 'content', signal: 'code/technical terms', user: 'developer_view' });
  }
  
  if (/(?:troubleshoot|error|fix|issue|problem|solution)/.test(allText)) {
    userScores.support_view += 1;
    signals.push({ type: 'content', signal: 'troubleshooting terms', user: 'support_view' });
  }
  
  const definitionCount = units.filter(u => u.unit_type === 'definition').length;
  if (definitionCount > 2) {
    userScores.research_view += 2;
    signals.push({ type: 'content', signal: 'high definition density', user: 'research_view' });
  }
  
  // Build intended_users array
  const intendedUsers = Object.entries(userScores)
    .filter(([_, score]) => score > 0)
    .map(([id, score]) => ({
      id,
      label: id.replace('_view', '').replace('_', ' '),
      confidence: Math.min(score / 5, 1.0), // Normalize to 0-1
      signals: signals.filter(s => s.user === id)
    }))
    .sort((a, b) => b.confidence - a.confidence);
  
  return intendedUsers;
}

// REQUIREMENT 8: Generate views (reshaped for intended users)
function generateViews(sections, units, intendedUsers, url) {
  const views = {};
  
  // Always generate research_view, support_view, buyer_view
  const viewTypes = ['research_view', 'support_view', 'buyer_view'];
  
  // Safety checks
  if (!sections) sections = [];
  if (!units) units = [];
  
  for (const viewType of viewTypes) {
    const viewUnits = {
      identity: [],
      definitions: [],
      key_claims: [],
      faqs: [],
      supporting_sections: [],
      actions: []
    };
    
    // Identity (entities + core facts)
    const facts = units.filter(u => u && u.unit_type === 'fact');
    viewUnits.identity = facts.map(u => u.unit_id).filter(Boolean);
    
    // Definitions
    const definitions = units.filter(u => u && u.unit_type === 'definition');
    viewUnits.definitions = definitions.map(u => u.unit_id).filter(Boolean);
    
    // Key claims
    const claims = units.filter(u => u && u.unit_type === 'claim');
    viewUnits.key_claims = claims.map(u => u.unit_id).filter(Boolean);
    
    // FAQs
    const faqQs = units.filter(u => u && u.unit_type === 'faq_q');
    const faqAs = units.filter(u => u && u.unit_type === 'faq_a');
    const faqPairs = [];
    for (const q of faqQs) {
      if (!q || !q.section_id) continue;
      // Find corresponding answer (simplified - in reality would use edges)
      const relatedAs = faqAs.filter(a => 
        a && a.section_id === q.section_id && 
        a.char_start > (q.char_end || 0)
      );
      if (relatedAs && relatedAs.length > 0 && relatedAs[0].unit_id) {
        faqPairs.push({ q_unit_id: q.unit_id, a_unit_id: relatedAs[0].unit_id });
      }
    }
    viewUnits.faqs = faqPairs;
    
    // Supporting sections (all sections for now)
    viewUnits.supporting_sections = sections.map(s => s && s.section_id ? s.section_id : null).filter(Boolean);
    
    // Actions (extracted from CTAs - simplified)
    viewUnits.actions = [];
    
    views[viewType] = {
      audience_id: viewType,
      summary_1_sentence: `${viewType.replace('_view', '')} view of ${url}`,
      key_entities: facts.map(f => (f.entity_refs && f.entity_refs.length > 0) ? f.entity_refs[0] : null).filter(Boolean),
      definitions: viewUnits.definitions,
      key_claims: viewUnits.key_claims,
      faqs: viewUnits.faqs,
      supporting_sections: viewUnits.supporting_sections,
      actions: viewUnits.actions
    };
  }
  
  return views;
}

// REQUIREMENT 11: QA metrics
function computeQAMetrics(sections, units, docCleanText, boilerplateSignals) {
  const totalChars = docCleanText.length;
  const removedChars = boilerplateSignals.removed_fragments.join(' ').length;
  const boilerplateRatio = totalChars > 0 ? removedChars / totalChars : 0;
  
  const unitsUnderCap = units.filter(u => u.clean_text.length <= 800).length;
  const unitAtomizationScore = units.length > 0 ? unitsUnderCap / units.length : 0;
  
  const unitsWithOffsets = units.filter(u => u.char_start !== undefined && u.char_end !== undefined).length;
  const provenanceCoverage = units.length > 0 ? unitsWithOffsets / units.length : 0;
  
  // Check for near-duplicates (simplified)
  const unitTexts = units.map(u => u.clean_text.toLowerCase().substring(0, 100));
  const uniqueTexts = new Set(unitTexts);
  const duplicateUnitRate = units.length > 0 ? (units.length - uniqueTexts.size) / units.length : 0;
  
  // View coherence (definitions before claims, identity first)
  const definitionsBeforeClaims = true; // Simplified
  const identityFirst = true; // Simplified
  const viewCoherence = definitionsBeforeClaims && identityFirst ? 1.0 : 0.5;
  
  return {
    boilerplate_ratio: boilerplateRatio,
    unit_atomization_score: unitAtomizationScore,
    provenance_coverage: provenanceCoverage,
    duplicate_unit_rate: duplicateUnitRate,
    view_coherence: viewCoherence
  };
}

// Main content extraction with all upgrades
function extractContentUniversal(html, baseUrl) {
  const docId = generateId(baseUrl, 'doc');
  const boilerplateSignals = { removed_fragments: [], rules_fired: [] };
  
  // Extract basic metadata
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  const meta = extractMetaTags(html);
  const structured_data = extractJSONLD(html);
  
  // Extract sections (retrieve-layer parents) with hard boilerplate scrubbing
  const sections = extractSections(html, baseUrl, docId, boilerplateSignals);
  
  // REQUIREMENT 1: Build doc_clean_text and fix provenance offsets
  const docCleanText = buildDocCleanText(sections);
  
  // Extract units (search-layer children)
  const units = [];
  const edges = [];
  
  // 1. Extract definition units (REQUIREMENT 4)
  const definitionUnits = extractDefinitionUnits(sections, docId, baseUrl, docCleanText);
  units.push(...definitionUnits);
  
  // 2. Normalize schema facts (REQUIREMENT 5)
  const { entities, units: schemaUnits } = normalizeSchemaFacts(structured_data, sections, docId, baseUrl, docCleanText);
  units.push(...schemaUnits);
  
  // 3. Extract FAQ units (atomized)
  const contentHash = crypto.createHash('sha256').update(docCleanText).digest('hex');
  const { units: faqUnits, edges: faqEdges } = extractFAQUnits(structured_data, sections, docId, baseUrl, docCleanText, contentHash);
  units.push(...faqUnits);
  edges.push(...faqEdges);
  
  // 4. Extract claim units (atomized)
  const claimUnits = extractClaimUnits(sections, docId, baseUrl, docCleanText);
  units.push(...claimUnits);
  
  // 5. Add assertion frames to all units (REQUIREMENT 6)
  for (const unit of units) {
    const section = sections.find(s => s.section_id === unit.section_id);
    if (section && !unit.assertion) {
      unit.assertion = createAssertionFrame(unit, section, baseUrl, contentHash);
    }
  }
  
  // 6. Generate expanded edges (REQUIREMENT 9)
  const expandedEdges = generateExpandedEdges(units, sections);
  edges.push(...expandedEdges);
  
  // 7. Infer intended users (REQUIREMENT 7)
  const intendedUsers = inferIntendedUsers(structured_data, sections, units);
  
  // 8. Generate views (REQUIREMENT 8)
  const views = generateViews(sections, units, intendedUsers, baseUrl);
  
  // 9. Compute QA metrics (REQUIREMENT 11)
  const qa = computeQAMetrics(sections, units, docCleanText, boilerplateSignals);
  
  return {
    doc_id: docId,
    title,
    meta,
    structured_data,
    doc_clean_text: docCleanText, // REQUIREMENT 1
    boilerplate_signals: boilerplateSignals, // REQUIREMENT 2
    entities, // REQUIREMENT 5
    intended_users: intendedUsers, // REQUIREMENT 7
    views, // REQUIREMENT 8
    sections,
    units,
    edges,
    qa // REQUIREMENT 11
  };
}

// Compute content hash for change detection
function computeContentHash(content) {
  const contentString = JSON.stringify(content);
  return crypto.createHash('sha256').update(contentString).digest('hex');
}

// POST /v1/ingest - Universal ingestion with all upgrades
export async function ingestUrl(req, res) {
  try {
    const { domain, url } = req.body;
    
    if (!domain || !url) {
      return res.status(400).json({ error: 'domain and url are required' });
    }

    // Validate URL format
    let canonicalUrl;
    try {
      canonicalUrl = new URL(url).href;
    } catch {
      return res.status(400).json({ error: 'Invalid URL format' });
    }

    // Fetch HTML snapshot
    const response = await fetch(canonicalUrl, {
      headers: {
        'User-Agent': 'Croutons-Ingestor/1.0'
      }
    });

    if (!response.ok) {
      return res.status(400).json({ 
        error: 'Failed to fetch URL',
        status: response.status,
        url: canonicalUrl
      });
    }

    const html = await response.text();

    // Store raw HTML snapshot
    await pool.query(`
      INSERT INTO html_snapshots (domain, source_url, html)
      VALUES ($1, $2, $3)
      ON CONFLICT (domain, source_url) 
      DO UPDATE SET 
        html = EXCLUDED.html,
        fetched_at = NOW()
    `, [domain, canonicalUrl, html]);

    // Extract content with all upgrades
    const extractedContent = extractContentUniversal(html, canonicalUrl);
    const contentHash = computeContentHash(extractedContent);

    res.json({
      ok: true,
      data: {
        domain,
        source_url: canonicalUrl,
        content_hash: contentHash,
        // Keep existing fields for backward compatibility
        doc_id: extractedContent.doc_id,
        title: extractedContent.title,
        meta: extractedContent.meta,
        structured_data: extractedContent.structured_data,
        sections: extractedContent.sections,
        units: extractedContent.units,
        edges: extractedContent.edges,
        // New fields (REQUIREMENT 10)
        doc_clean_text: extractedContent.doc_clean_text,
        boilerplate_signals: extractedContent.boilerplate_signals,
        entities: extractedContent.entities,
        intended_users: extractedContent.intended_users,
        views: extractedContent.views,
        qa: extractedContent.qa,
        fetched_at: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Ingestion error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
}
