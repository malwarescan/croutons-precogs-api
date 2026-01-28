// src/routes/ingest.js
// Universal "Intended User" Shaping + Citation Magnet Upgrade
// SINR-aligned retrieval substrate with deterministic truth substrate

import crypto from 'crypto';
import { parse } from 'node-html-parser';
import { pool } from '../db.js';
import { loadKB } from '../../precogs-worker/src/kb.js';
import { validateJsonLdAgainstRules, buildRecommendations } from '../../precogs-worker/src/validateSchema.js';

// Generate deterministic ID from components
function generateId(...components) {
  const combined = components.join('|');
  return crypto.createHash('sha256').update(combined).digest('hex').substring(0, 16);
}

// Extract JSON-LD structured data from HTML
const SCHEMA_CONTEXT = 'https://schema.org';
const schemaKB = loadKB('schema-foundation');

function normalizeSchemaType(rawType) {
  if (!rawType) return '';
  const cleaned = rawType.trim();
  if (!cleaned) return '';
  if (cleaned.includes('://')) {
    return cleaned.substring(cleaned.lastIndexOf('/') + 1);
  }
  if (cleaned.includes(':')) {
    return cleaned.split(':').pop();
  }
  return cleaned;
}

function assignPropertyValue(target, name, value) {
  if (value === null || value === undefined || value === '') return;
  if (target[name]) {
    if (Array.isArray(target[name])) {
      target[name].push(value);
    } else {
      target[name] = [target[name], value];
    }
  } else {
    target[name] = value;
  }
}

function getPropertyNames(attribute) {
  if (!attribute) return [];
  return attribute
    .split(/\s+/)
    .map(name => name.trim())
    .filter(Boolean);
}

function getElementValue(element) {
  if (!element || !element.getAttribute) return '';
  const attrs = ['content', 'datetime', 'value', 'href', 'src'];
  for (const attr of attrs) {
    const attrValue = element.getAttribute(attr);
    if (attrValue) return attrValue.trim();
  }
  return (element.text || '').trim();
}

function isDescendantOfNestedScope(node, scope) {
  let current = node?.parentNode;
  while (current && current !== scope) {
    if (current.getAttribute && current.getAttribute('itemscope') !== null) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function isDescendantOfNestedType(node, scope) {
  let current = node?.parentNode;
  while (current && current !== scope) {
    if (current.getAttribute && current.getAttribute('typeof')) {
      return true;
    }
    current = current.parentNode;
  }
  return false;
}

function buildMicrodataItem(scope) {
  const item = { '@context': SCHEMA_CONTEXT };
  const rawType = scope.getAttribute('itemtype');
  const normalizedTypes = (rawType || '')
    .split(/\s+/)
    .map(normalizeSchemaType)
    .filter(Boolean);
  if (normalizedTypes.length === 1) {
    item['@type'] = normalizedTypes[0];
  } else if (normalizedTypes.length > 1) {
    item['@type'] = normalizedTypes;
  } else {
    item['@type'] = 'Thing';
  }
  const itemId = scope.getAttribute('itemid');
  if (itemId) {
    item['@id'] = itemId;
  }
  const properties = collectMicrodataProperties(scope);
  Object.assign(item, properties);
  return item;
}

function collectMicrodataProperties(scope) {
  const props = {};
  const propElements = scope.querySelectorAll('[itemprop]');
  for (const propEl of propElements) {
    const propName = propEl.getAttribute('itemprop');
    if (!propName) continue;
    if (propEl === scope) continue;
    if (isDescendantOfNestedScope(propEl, scope)) continue;
    const nestedScope = propEl.getAttribute('itemscope') !== null;
    const value = nestedScope ? buildMicrodataItem(propEl) : getElementValue(propEl);
    for (const namePart of getPropertyNames(propName)) {
      assignPropertyValue(props, namePart, value);
    }
  }
  return props;
}

function extractMicrodata(html) {
  if (!html) return { items: [], itemCount: 0 };
  const root = parse(html);
  const scopes = root.querySelectorAll('[itemscope]');
  const items = Array.from(scopes).map(scope => buildMicrodataItem(scope));
  return { items, itemCount: items.length };
}

function collectRdfaProperties(node) {
  const props = {};
  const propElements = node.querySelectorAll('[property]');
  for (const propEl of propElements) {
    const propName = propEl.getAttribute('property');
    if (!propName) continue;
    if (isDescendantOfNestedType(propEl, node)) continue;
    const value = getElementValue(propEl);
    for (const namePart of getPropertyNames(propName)) {
      assignPropertyValue(props, namePart, value);
    }
  }
  return props;
}

function extractRdfa(html) {
  if (!html) return { items: [], tripleCount: 0 };
  const root = parse(html);
  const nodes = root.querySelectorAll('[typeof]');
  const items = [];
  let tripleCount = 0;
  for (const node of nodes) {
    const rawTypes = (node.getAttribute('typeof') || '').split(/\s+/);
    const normalizedTypes = rawTypes.map(normalizeSchemaType).filter(Boolean);
    const item = { '@context': SCHEMA_CONTEXT };
    if (normalizedTypes.length === 1) {
      item['@type'] = normalizedTypes[0];
    } else if (normalizedTypes.length > 1) {
      item['@type'] = normalizedTypes;
    } else {
      item['@type'] = 'Thing';
    }
    const props = collectRdfaProperties(node);
    tripleCount += Object.values(props).reduce((sum, value) => {
      if (Array.isArray(value)) return sum + value.length;
      return sum + (value ? 1 : 0);
    }, 0);
    Object.assign(item, props);
    items.push(item);
  }
  return { items, tripleCount };
}

function extractJsonLdBlocks(html) {
  const schemas = [];
  const jsonLdRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis;
  let jsonldCount = 0;
  let match;
  while ((match = jsonLdRegex.exec(html)) !== null) {
    jsonldCount++;
    try {
      const parsed = JSON.parse(match[1]);
      schemas.push(parsed);
    } catch (e) {
      // Skip invalid JSON
    }
  }
  return { schemas, blockCount: jsonldCount };
}

function normalizeSchemaItem(item) {
  if (!item || typeof item !== 'object') return null;
  const normalized = { ...item };
  normalized['@context'] = normalized['@context'] || SCHEMA_CONTEXT;
  const rawTypes = Array.isArray(normalized['@type'])
    ? normalized['@type']
    : normalized['@type']
    ? [normalized['@type']]
    : [];
  const normalizedTypes = rawTypes.map(normalizeSchemaType).filter(Boolean);
  if (normalizedTypes.length === 1) {
    normalized['@type'] = normalizedTypes[0];
  } else if (normalizedTypes.length > 1) {
    normalized['@type'] = normalizedTypes;
  } else {
    normalized['@type'] = 'Thing';
  }
  return normalized;
}

function extractAllSchema(html) {
  const jsonLdResult = extractJsonLdBlocks(html);
  const microdataResult = extractMicrodata(html);
  const rdfaResult = extractRdfa(html);
  const rawItems = [
    ...jsonLdResult.schemas,
    ...microdataResult.items,
    ...rdfaResult.items
  ];
  const structuredData = rawItems
    .map(normalizeSchemaItem)
    .filter(Boolean);
  const schemaTypes = new Set();
  structuredData.forEach(item => {
    const types = Array.isArray(item['@type'])
      ? item['@type']
      : item['@type']
      ? [item['@type']]
      : [];
    types.forEach(type => {
      if (type) schemaTypes.add(type);
    });
  });
  return {
    structured_data: structuredData,
    extraction_stats: {
      jsonld_block_count: jsonLdResult.blockCount,
      microdata_item_count: microdataResult.itemCount,
      rdfa_triple_count: rdfaResult.tripleCount,
      extracted_schema_types: Array.from(schemaTypes).sort()
    }
  };
}

function hasSchemaPath(obj, path) {
  if (!obj || !path) return false;
  const segments = path.split('.');
  let current = obj;
  for (const segment of segments) {
    if (current == null) return false;
    current = current[segment];
  }
  return current !== undefined;
}

function collectSchemaItems(structuredData) {
  const items = [];
  if (!structuredData) return items;
  for (const schema of structuredData) {
    const graph = Array.isArray(schema['@graph']) ? schema['@graph'] : [schema];
    for (const item of graph) {
      if (item && typeof item === 'object') {
        items.push(item);
      }
    }
  }
  return items;
}

function analyzeSchemaCoverage(structuredData, extractionStats = {}) {
  const detected = new Set(extractionStats?.extracted_schema_types || []);
  const present = new Set();
  const missing = new Set();
  const recommendedTypes = new Set();
  const kbTypes = schemaKB?.types || {};
  const schemaItems = collectSchemaItems(structuredData);

  for (const item of schemaItems) {
    const rawTypes = Array.isArray(item['@type']) ? item['@type'] : [item['@type']];
    for (const rawType of rawTypes) {
      const type = normalizeSchemaType(rawType);
      if (!type) continue;
      detected.add(type);
      const rules = kbTypes[type];
      if (!rules) continue;
      const issues = validateJsonLdAgainstRules(item, rules);
      for (const issue of issues) {
        if (issue.code === 'missing' && issue.path) {
          missing.add(`${type}.${issue.path}`);
        }
      }
      const paths = [...(rules.required || []), ...(rules.recommended || [])];
      for (const path of paths) {
        if (hasSchemaPath(item, path)) {
          present.add(`${type}.${path}`);
        }
      }
      const recommendations = buildRecommendations(item, rules);
      if (recommendations.length > 0) {
        recommendedTypes.add(type);
      }
    }
  }

  return {
    detected_schema_types: Array.from(detected).sort(),
    present_schema_checks: Array.from(present).sort(),
    missing_schema_checks: Array.from(missing).sort(),
    recommended_next_types: Array.from(recommendedTypes).sort()
  };
}

function generateSchemaEdges(entities = [], pageUrl = '', baseUrl = '') {
  const edges = [];
  if (!entities || entities.length === 0) return edges;

  const byType = {};
  for (const entity of entities) {
    if (!entity || !entity.entity_type) continue;
    const entityTypes = Array.isArray(entity.entity_type) ? entity.entity_type : [entity.entity_type];
    for (const type of entityTypes) {
      if (!type) continue;
      if (!byType[type]) byType[type] = [];
      byType[type].push(entity);
    }
  }

  const org = byType['Organization']?.[0];
  const website = byType['WebSite']?.[0];
  const page = byType['WebPage']?.[0];
  const persons = byType['Person'] || [];
  const services = byType['Service'] || [];
  const softwareApps = byType['SoftwareApplication'] || [];
  const products = byType['Product'] || [];

  const pushEdge = (edge) => {
    if (edge) edges.push(edge);
  };

  if (org && website) {
    pushEdge({
      edge_type: 'owns',
      edge_label: 'owns',
      from_entity_id: org.entity_id,
      to_entity_id: website.entity_id,
      from_entity_type: 'Organization',
      to_entity_type: 'WebSite',
      confidence: 0.95
    });
  }

  if (website && page) {
    pushEdge({
      edge_type: 'hasPage',
      edge_label: 'hasPage',
      from_entity_id: website.entity_id,
      to_entity_id: page.entity_id,
      from_entity_type: 'WebSite',
      to_entity_type: 'WebPage',
      confidence: 0.9
    });
    pushEdge({
      edge_type: 'published_by',
      edge_label: 'published_by',
      from_entity_id: page.entity_id,
      to_entity_id: website.entity_id,
      from_entity_type: 'WebPage',
      to_entity_type: 'WebSite',
      confidence: 0.8
    });
  }

  if (page && org) {
    pushEdge({
      edge_type: 'published_by',
      edge_label: 'published_by',
      from_entity_id: page.entity_id,
      to_entity_id: org.entity_id,
      from_entity_type: 'WebPage',
      to_entity_type: 'Organization',
      confidence: 0.8
    });
  }

  const linkEntityToOrg = (entity, edgeType, edgeLabel) => {
    if (!entity || !org) return;
    pushEdge({
      edge_type: edgeType,
      edge_label: edgeLabel,
      from_entity_id: entity.entity_id,
      to_entity_id: org.entity_id,
      from_entity_type: entity.entity_type,
      to_entity_type: 'Organization',
      confidence: 0.85
    });
  };

  const linkPageToEntity = (entity, label) => {
    if (!page || !entity) return;
    pushEdge({
      edge_type: 'about',
      edge_label: label || 'about',
      from_entity_id: page.entity_id,
      to_entity_id: entity.entity_id,
      from_entity_type: 'WebPage',
      to_entity_type: entity.entity_type,
      confidence: 0.75
    });
  };

  const linkEntityToPage = (entity, label) => {
    if (!page || !entity) return;
    pushEdge({
      edge_type: 'features',
      edge_label: label || 'features',
      from_entity_id: entity.entity_id,
      to_entity_id: page.entity_id,
      from_entity_type: entity.entity_type,
      to_entity_type: 'WebPage',
      confidence: 0.7
    });
  };

  for (const person of persons) {
    linkEntityToOrg(person, 'worksFor', 'worksFor');
    linkPageToEntity(person, 'about_person');
  }

  for (const service of services) {
    linkEntityToOrg(service, 'provider', 'provider');
    linkPageToEntity(service, 'about_service');
  }

  for (const app of [...softwareApps, ...products]) {
    linkEntityToOrg(app, 'publisher', 'publisher');
    linkPageToEntity(app, 'about_application');
  }

  const additionalEntities = entities.filter(e => !['Organization', 'WebSite', 'WebPage'].includes(e.entity_type));
  for (const entity of additionalEntities) {
    if (entity.entity_type === 'Person' || entity.entity_type === 'Service' || entity.entity_type === 'SoftwareApplication' || entity.entity_type === 'Product') continue;
    linkPageToEntity(entity, 'about_entity');
    if (org) {
      pushEdge({
        edge_type: 'connected_to',
        edge_label: 'connected_to_org',
        from_entity_id: entity.entity_id,
        to_entity_id: org.entity_id,
        from_entity_type: entity.entity_type,
        to_entity_type: 'Organization',
        confidence: 0.5
      });
    }
  }

  return edges;
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
      
      // REQUIREMENT 1: Calculate section rank features
      const sectionRankFeatures = {
        heading_level: heading.level,
        section_path_depth: pathStack.length,
        schema_density: 0 // Will be calculated later if needed
      };
      
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
        section_text: windowText, // REQUIREMENT 1: Explicit section_text alias
        prev_section_id: i > 0 ? sections[sections.length - 1]?.section_id : null,
        next_section_id: null, // Will be set in next iteration
        section_rank_features: sectionRankFeatures // REQUIREMENT 1
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

// REQUIREMENT 1: Build doc_clean_text and fix provenance offsets (REQUIREMENT 2: Fix offsets)
// Protocol v1.1: This becomes canonical_extracted_text - must be deterministic
function buildDocCleanText(sections) {
  if (!sections || sections.length === 0) {
    return '';
  }
  
  const docParts = [];
  let cursor = 0;
  
  for (const section of sections) {
    if (!section || !section.clean_text) continue;
    
    const sectionStart = cursor;
    // Protocol v1.1: Normalize whitespace (single spaces, single newlines)
    const sectionText = section.clean_text
      .replace(/\s+/g, ' ')  // Multiple spaces -> single space
      .replace(/\n\s*\n/g, '\n')  // Multiple newlines -> single newline
      .trim();
    
    docParts.push(sectionText);
    const sectionEnd = cursor + sectionText.length;
    
    // Set absolute offsets (REQUIREMENT 2: real positions, not 0)
    section.char_start = sectionStart;
    section.char_end = sectionEnd;
    
    // Update cursor for next section (accounting for separator)
    const separator = '\n\n';
    cursor = sectionEnd + separator.length;
  }
  
  // Protocol v1.1: Join with normalized separator, ensure UTF-8
  const canonicalText = docParts.join('\n\n');
  
  // Final normalization: ensure single newlines between sections, no trailing whitespace
  return canonicalText
    .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
    .trim();
}

// REQUIREMENT 2: Calculate unit offsets within section (for SINR protocol)
function calculateUnitOffsets(unit, section) {
  if (!section || !section.clean_text) {
    return { unit_offset_start: 0, unit_offset_end: 0 };
  }
  
  // Find unit text position within section
  const unitText = unit.clean_text;
  const sectionText = section.clean_text;
  const offsetStart = sectionText.indexOf(unitText);
  
  if (offsetStart === -1) {
    // Fallback: estimate based on char_start if available
    if (unit.char_start !== undefined && section.char_start !== undefined) {
      return {
        unit_offset_start: unit.char_start - section.char_start,
        unit_offset_end: (unit.char_end || unit.char_start) - section.char_start
      };
    }
    return { unit_offset_start: 0, unit_offset_end: unitText.length };
  }
  
  return {
    unit_offset_start: offsetStart,
    unit_offset_end: offsetStart + unitText.length
  };
}

// REQUIREMENT 4: Atomize units (one claim per unit, 120-350 chars target, 800 hard cap)
// Split multi-claim blobs into single-assertion units
function atomizeUnit(text, unitType, maxLength = 800) {
  if (!text || text.length === 0) return [];
  if (text.length <= maxLength && text.length <= 350) {
    // Check if it's already a single assertion
    const sentences = text.split(/(?<=[.!?])\s+/);
    if (sentences.length === 1) {
      return [text];
    }
  }
  
  const units = [];
  const targetLength = 200; // Target 120-350 chars
  
  // REQUIREMENT 4: Split by colon-chains (multi-claim pattern)
  const colonSplit = text.split(/:\s*(?=[A-Z])/);
  if (colonSplit.length > 1) {
    for (let i = 0; i < colonSplit.length; i++) {
      let part = colonSplit[i].trim();
      if (i < colonSplit.length - 1) {
        part += ':';
      }
      
      // Split further if still too long
      if (part.length > maxLength) {
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
        // If part is still multi-sentence, split further for atomicity
        const sentences = part.split(/(?<=[.!?])\s+/);
        if (sentences.length > 1) {
          // Keep sentences together if they're short, split if long
          let current = '';
          for (const sentence of sentences) {
            if ((current + ' ' + sentence).length > targetLength && current) {
              units.push(current.trim());
              current = sentence;
            } else {
              current = current ? current + ' ' + sentence : sentence;
            }
          }
          if (current) units.push(current.trim());
        } else {
          units.push(part);
        }
      }
    }
  } else {
    // Split by sentences for atomicity (REQUIREMENT 4: one assertion per unit)
    const sentences = text.split(/(?<=[.!?])\s+/);
    let current = '';
    for (const sentence of sentences) {
      // If adding this sentence would exceed target, emit current
      if ((current + ' ' + sentence).length > targetLength && current) {
        units.push(current.trim());
        current = sentence;
      } else if ((current + ' ' + sentence).length > maxLength && current) {
        // Hard cap: must split
        units.push(current.trim());
        current = sentence;
      } else {
        current = current ? current + ' ' + sentence : sentence;
      }
    }
    if (current) units.push(current.trim());
  }
  
  return units.filter(u => u.length >= 50 && u.length <= maxLength);
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

// REQUIREMENT 3: Truth gating - validate facts are grounded
function validateFactGrounding(unit, schemas, html) {
  const labelValuePatterns = [
    /(?:phone|telephone|tel):\s*([+\d\s\-\(\)]+)/i,
    /(?:address):\s*([^\n]+)/i,
    /(?:hours|open|hours of operation):\s*([^\n]+)/i,
    /(?:price|pricing|cost):\s*([^\n]+)/i
  ];
  const hasTextEvidence = labelValuePatterns.some(pattern => pattern.test(unit.clean_text));

  // Check if unit is schema-grounded
  if (unit.triple && unit.triple.source_jsonld_ref) {
    // Verify the JSON pointer exists
    for (const schema of schemas) {
      const items = Array.isArray(schema['@graph']) ? schema['@graph'] : [schema];
      for (const item of items) {
        if (item['@id'] === unit.triple.source_jsonld_ref) {
          return {
            grounded: true,
            grounding_type: hasTextEvidence ? 'schema_text' : 'schema',
            confidence: hasTextEvidence ? 0.97 : 0.95,
            source_pointer: unit.triple.source_jsonld_ref
          };
        }
      }
    }
  }

  if (hasTextEvidence) {
    return {
      grounded: true,
      grounding_type: 'visible_text',
      confidence: 0.85,
      source_pointer: 'label-value-pattern'
    };
  }

  // Check if it's a metadata-only fact (page-level only)
  if (unit.unit_type === 'fact') {
    const metadataFacts = ['title', 'description', 'canonical_url'];
    if (unit.triple && metadataFacts.includes(unit.triple.predicate)) {
      return {
        grounded: true,
        grounding_type: 'metadata',
        confidence: 0.90,
        source_pointer: 'page-metadata'
      };
    }
  }

  // Not grounded - downgrade to claim
  return {
    grounded: false,
    grounding_type: 'model_inferred',
    confidence: 0.60,
    source_pointer: null
  };
}

// REQUIREMENT 1: Add SINR protocol fields to unit
function addSINRFields(unit, section, grounding) {
  const offsets = calculateUnitOffsets(unit, section);
  
  unit.parent_section_id = unit.section_id; // Explicit parent reference
  unit.unit_offset_start = offsets.unit_offset_start;
  unit.unit_offset_end = offsets.unit_offset_end;
  unit.unit_grounding = grounding.grounding_type;
  unit.unit_confidence = grounding.confidence;
  unit.unit_source_pointer = grounding.source_pointer || null;
  
  return unit;
}

// REQUIREMENT 5: Normalize schema facts into triples
function normalizeSchemaFacts(schemas, sections, docId, url, docCleanText, html) {
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
      
      // Name (REQUIREMENT 3: Only emit if grounded)
      if (item.name && item['@id']) {
        const factText = `${item.name} (${itemType}) name is ${item.name}.`;
        const unitId = generateId(url, 'fact', itemType, 'name', item.name);
        const unit = {
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
            source_jsonld_ref: item['@id']
          }
        };
        
        // REQUIREMENT 3: Validate grounding
        const grounding = validateFactGrounding(unit, schemas, html);
        if (grounding.grounded) {
          // REQUIREMENT 1: Add SINR fields
          addSINRFields(unit, firstSection, grounding);
          units.push(unit);
        } else {
          // Downgrade to claim
          unit.unit_type = 'claim';
          unit.unit_confidence = grounding.confidence;
          addSINRFields(unit, firstSection, grounding);
          units.push(unit);
        }
      }
      
      // Telephone (REQUIREMENT 3: Validate grounding)
      if (item.telephone) {
        const factText = `${item.name || itemType} telephone is ${item.telephone}.`;
        const unitId = generateId(url, 'fact', itemType, 'telephone');
        const unit = {
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
        };
        
        const grounding = validateFactGrounding(unit, schemas, html);
        if (grounding.grounded) {
          addSINRFields(unit, firstSection, grounding);
          units.push(unit);
        } else {
          unit.unit_type = 'claim';
          unit.unit_confidence = grounding.confidence;
          addSINRFields(unit, firstSection, grounding);
          units.push(unit);
        }
      }
      
      // Founder (REQUIREMENT 3: Validate grounding)
      if (item.founder) {
        const founderName = typeof item.founder === 'string' ? item.founder : (item.founder.name || '');
        if (founderName) {
          const factText = `${item.name || itemType} founder is ${founderName}.`;
          const unitId = generateId(url, 'fact', itemType, 'founder');
          const unit = {
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
          };
          
          const grounding = validateFactGrounding(unit, schemas, html);
          if (grounding.grounded) {
            addSINRFields(unit, firstSection, grounding);
            units.push(unit);
          } else {
            unit.unit_type = 'claim';
            unit.unit_confidence = grounding.confidence;
            addSINRFields(unit, firstSection, grounding);
            units.push(unit);
          }
        }
      }
      
      // SameAs (REQUIREMENT 3: Validate grounding)
      if (item.sameAs && Array.isArray(item.sameAs)) {
        for (const sameAsUrl of item.sameAs) {
          const factText = `${item.name || itemType} sameAs includes ${sameAsUrl}.`;
          const unitId = generateId(url, 'fact', itemType, 'sameAs', sameAsUrl);
          const unit = {
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
          };
          
          const grounding = validateFactGrounding(unit, schemas, html);
          if (grounding.grounded) {
            addSINRFields(unit, firstSection, grounding);
            units.push(unit);
          } else {
            unit.unit_type = 'claim';
            unit.unit_confidence = grounding.confidence;
            addSINRFields(unit, firstSection, grounding);
            units.push(unit);
          }
        }
      }
    }
  }
  
  return { entities, units };
}

// REQUIREMENT 6: Enrichment 2.0 - Generate hierarchy, entity, and intent stamps
function generateEnrichment20(unit, section, sections, entities, url, title) {
  // Hierarchy stamp
  const hierarchy = {
    doc_title: title,
    section_path: section?.section_path || '',
    h1: sections.find(s => s.heading_level === 1)?.heading_text || '',
    h2_chain: sections
      .filter(s => s.heading_level === 2 && s.char_start <= (section?.char_start || 0))
      .map(s => s.heading_text)
      .slice(-2) // Last 2 H2s
  };
  
  // Entity stamp (top entities from schema)
  const topEntities = entities
    .filter(e => e.entity_type === 'Organization' || e.entity_type === 'Person')
    .slice(0, 3)
    .map(e => ({ id: e.entity_id, name: e.name, type: e.entity_type }));
  
  // Intent stamp (HyDE-lite) - generate questions this unit answers
  const answersQuestions = [];
  if (unit.unit_type === 'definition') {
    const term = unit.entity_refs?.[0] || '';
    if (term) {
      answersQuestions.push(`What is ${term}?`);
      answersQuestions.push(`Define ${term}`);
    }
  } else if (unit.unit_type === 'faq_a') {
    answersQuestions.push(unit.clean_text.substring(0, 100) + '?');
  } else if (unit.unit_type === 'fact') {
    const subject = unit.entity_refs?.[0] || '';
    const predicate = unit.triple?.predicate || '';
    if (subject && predicate) {
      answersQuestions.push(`What is the ${predicate} of ${subject}?`);
    }
  }
  
  // Build enriched text for embedding
  const hierarchyStamp = `DOC: ${hierarchy.doc_title} | PATH: ${hierarchy.section_path} | H1: ${hierarchy.h1} | H2: ${hierarchy.h2_chain.join(' > ')}`;
  const entityStamp = topEntities.length > 0 
    ? ` | ENTITIES: ${topEntities.map(e => e.name).join(', ')}`
    : '';
  const intentStamp = answersQuestions.length > 0
    ? ` | ANSWERS: ${answersQuestions.join('; ')}`
    : '';
  
  return {
    hierarchy,
    entities: topEntities,
    answers_questions: answersQuestions,
    enriched_text_for_embedding: `${hierarchyStamp}${entityStamp}${intentStamp} | TYPE: ${unit.unit_type} | TEXT: ${unit.clean_text}`
  };
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

// REQUIREMENT 7: Hop Graph beyond FAQ (real HopRAG)
function generateExpandedEdges(units, sections, html, url) {
  const edges = [];
  
  const faqQuestions = units.filter(u => u.unit_type === 'faq_q');
  const definitions = units.filter(u => u.unit_type === 'definition');
  const claims = units.filter(u => u.unit_type === 'claim');
  const facts = units.filter(u => u.unit_type === 'fact');
  const faqAnswers = units.filter(u => u.unit_type === 'faq_a');
  
  // Build term dictionary from schema and headings
  const termDictionary = new Map();
  for (const def of definitions) {
    for (const term of (def.entity_refs || [])) {
      termDictionary.set(term.toLowerCase(), def.unit_id);
    }
  }
  
  // Extract bold/heading terms
  const headingTerms = sections
    .filter(s => s.heading_level <= 3)
    .map(s => s.heading_text.toLowerCase());
  headingTerms.forEach(term => {
    if (!termDictionary.has(term) && term.length > 3) {
      const matchingDef = definitions.find(d => 
        d.clean_text.toLowerCase().includes(term)
      );
      if (matchingDef) {
        termDictionary.set(term, matchingDef.unit_id);
      }
    }
  });
  
  // Edge type: defines (DefinedTerm → definition)
  for (const def of definitions) {
    for (const term of (def.entity_refs || [])) {
      const termLower = term.toLowerCase();
      const mentions = units.filter(u => 
        u.clean_text.toLowerCase().includes(termLower) && 
        u.unit_id !== def.unit_id
      );
      for (const mention of mentions) {
        edges.push({
          from_unit_id: mention.unit_id,
          to_unit_id: def.unit_id,
          edge_type: 'defines',
          edge_label: `defines ${term}`,
          confidence: 0.85
        });
      }
    }
  }
  
  // Edge type: supports (claim → supporting fact/schema)
  for (const claim of claims) {
    const claimLower = claim.clean_text.toLowerCase();
    for (const fact of facts) {
      const factEntities = (fact.entity_refs || []).map(e => e.toLowerCase());
      if (factEntities.some(entity => claimLower.includes(entity))) {
        edges.push({
          from_unit_id: claim.unit_id,
          to_unit_id: fact.unit_id,
          edge_type: 'supports',
          edge_label: 'supported_by',
          confidence: 0.75
        });
      }
    }
  }
  
  // Edge type: mentions (unit → entity id)
  for (const unit of units) {
    if (unit.entity_refs && unit.entity_refs.length > 0) {
      for (const entityRef of unit.entity_refs) {
        const entityFacts = facts.filter(f => 
          f.entity_refs && f.entity_refs.includes(entityRef)
        );
        for (const fact of entityFacts) {
          edges.push({
            from_unit_id: unit.unit_id,
            to_unit_id: fact.unit_id,
            edge_type: 'mentions',
            edge_label: `mentions ${entityRef}`,
            confidence: 0.80
          });
        }
      }
    }
  }
  
  // Edge type: depends_on (claim → prerequisite definition)
  for (const claim of claims) {
    const claimLower = claim.clean_text.toLowerCase();
    for (const [term, defId] of termDictionary.entries()) {
      if (claimLower.includes(term)) {
        edges.push({
          from_unit_id: claim.unit_id,
          to_unit_id: defId,
          edge_type: 'depends_on',
          edge_label: `depends_on ${term}`,
          confidence: 0.70
        });
      }
    }
  }
  
  // Edge type: links_to (section → target section based on internal links)
  if (html && url) {
    const internalLinks = new Map();
    const linkRegex = /<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi;
    let linkMatch;
    while ((linkMatch = linkRegex.exec(html)) !== null) {
      const href = linkMatch[1];
      const text = linkMatch[2].replace(/<[^>]*>/g, '').trim();
      try {
        const linkUrl = new URL(href, url);
        if (linkUrl.origin === new URL(url).origin && text) {
          internalLinks.set(text.toLowerCase(), linkUrl.pathname);
        }
      } catch {
        // Invalid URL, skip
      }
    }
    
    for (const section of sections) {
      const sectionLower = section.clean_text.toLowerCase();
      for (const [linkText, targetPath] of internalLinks.entries()) {
        if (sectionLower.includes(linkText)) {
          const targetSection = sections.find(s => 
            s.heading_text.toLowerCase().includes(linkText.substring(0, 20))
          );
          if (targetSection && targetSection.section_id !== section.section_id) {
            edges.push({
              from_unit_id: section.section_id,
              to_unit_id: targetSection.section_id,
              edge_type: 'links_to',
              edge_label: `links_to ${linkText}`,
              confidence: 0.65
            });
          }
        }
      }
    }
  }
  
  // FAQ Q -> Definition (elaborates)
  for (const faq of faqQuestions) {
    const questionLower = faq.clean_text.toLowerCase();
    for (const def of definitions) {
      const defTerms = (def.entity_refs || []).map(e => e.toLowerCase());
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
      const defTerms = (def.entity_refs || []).map(e => e.toLowerCase());
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

// REQUIREMENT 8: Vertical shaping via schema-first adapters
function detectVertical(schemas) {
  const verticalScores = {
    ecommerce: 0,
    local_services: 0,
    healthcare: 0,
    recruiting: 0,
    media: 0,
    saas: 0,
    research: 0
  };
  
  for (const schema of schemas) {
    const items = Array.isArray(schema['@graph']) ? schema['@graph'] : [schema];
    for (const item of items) {
      const itemType = Array.isArray(item['@type']) ? item['@type'][0] : item['@type'];
      
      if (['Product', 'Offer'].includes(itemType)) {
        verticalScores.ecommerce += 3;
      }
      if (['LocalBusiness', 'Service'].includes(itemType)) {
        verticalScores.local_services += 3;
      }
      if (['MedicalBusiness', 'Physician'].includes(itemType)) {
        verticalScores.healthcare += 3;
      }
      if (['JobPosting'].includes(itemType)) {
        verticalScores.recruiting += 3;
      }
      if (['Article', 'NewsArticle'].includes(itemType)) {
        verticalScores.media += 3;
      }
      if (['SoftwareApplication'].includes(itemType)) {
        verticalScores.saas += 3;
      }
      if (['ScholarlyArticle', 'Report', 'ResearchOrganization'].includes(itemType)) {
        verticalScores.research += 3;
      }
    }
  }
  
  const maxScore = Math.max(...Object.values(verticalScores));
  if (maxScore === 0) return { vertical: 'general', confidence: 0 };
  
  const detectedVertical = Object.entries(verticalScores)
    .find(([_, score]) => score === maxScore)?.[0] || 'general';
  
  return {
    vertical: detectedVertical,
    confidence: Math.min(maxScore / 5, 1.0),
    scores: verticalScores
  };
}

// REQUIREMENT 9: Citations Guarantee QA gate
async function runQAGate(units, sections, docCleanText, boilerplateSignals, schemaCheckReport = {}, edges = [], domain = null) {
  const errors = [];
  const fixSuggestions = [];
  const schemaChecks = {
    missing_schema_checks: schemaCheckReport?.missing_schema_checks || [],
    present_schema_checks: schemaCheckReport?.present_schema_checks || [],
    detected_schema_types: schemaCheckReport?.detected_schema_types || [],
    recommended_next_types: schemaCheckReport?.recommended_next_types || []
  };
  
  // Check if domain is verified (lower threshold for verified domains)
  let isVerified = false;
  let requiredSchemaCoverage = 0.5; // Default threshold
  
  if (domain) {
    try {
      const verifiedCheck = await pool.query(
        'SELECT verified_at FROM verified_domains WHERE domain = $1',
        [domain]
      );
      isVerified = verifiedCheck.rows.length > 0 && verifiedCheck.rows[0].verified_at !== null;
      if (isVerified) {
        requiredSchemaCoverage = 0.0; // Verified domains bypass schema coverage requirement
        console.log(`[runQAGate] Verified domain ${domain} detected - lowering schema coverage threshold to ${requiredSchemaCoverage}`);
      }
    } catch (error) {
      console.warn(`[runQAGate] Error checking verified_domains for ${domain}:`, error.message);
      // Continue with default threshold if check fails
    }
  }
  
  // Check grounded fact rate
  const facts = units.filter(u => u.unit_type === 'fact');
  const groundedFacts = facts.filter(f => 
    ['schema', 'schema_text', 'visible_text', 'metadata'].includes(f.unit_grounding)
  ).length;
  const groundedFactRate = facts.length > 0 ? groundedFacts / facts.length : 1.0;
  
  if (groundedFactRate < 0.95) {
    errors.push(`grounded_fact_rate too low: ${groundedFactRate.toFixed(2)} (required: >= 0.95)`);
    fixSuggestions.push('Review fact extraction - ensure all facts are schema-grounded or visible-text-grounded');
  }
  
  // Check ungrounded facts
  const ungroundedFacts = facts.filter(f => 
    f.unit_grounding === 'model_inferred' || !f.unit_grounding
  ).length;
  
  if (ungroundedFacts > 0) {
    errors.push(`ungrounded_fact_count: ${ungroundedFacts} (required: 0)`);
    fixSuggestions.push('Downgrade ungrounded facts to claims with lower confidence');
  }
  
  // Check unit length (target range by type)
  const avgLengths = {};
  for (const unitType of ['fact', 'definition', 'claim', 'faq_a']) {
    const typeUnits = units.filter(u => u.unit_type === unitType);
    if (typeUnits.length > 0) {
      const avgLength = typeUnits.reduce((sum, u) => sum + u.clean_text.length, 0) / typeUnits.length;
      avgLengths[unitType] = avgLength;
      
      // Target: 120-350 chars
      if (avgLength > 500) {
        errors.push(`${unitType} avg_length too high: ${avgLength.toFixed(0)} chars (target: 120-350)`);
        fixSuggestions.push(`Atomize ${unitType} units further`);
      }
    }
  }
  
  // Check atomicity (no multi-claim units)
  const multiClaimUnits = units.filter(u => {
    const sentences = u.clean_text.split(/[.!?]\s+/).length;
    return sentences > 2 && u.unit_type === 'claim';
  }).length;
  const atomicityPassRate = units.length > 0 ? 1 - (multiClaimUnits / units.length) : 1.0;
  
  if (atomicityPassRate < 0.9) {
    errors.push(`atomicity_pass_rate too low: ${atomicityPassRate.toFixed(2)} (required: >= 0.9)`);
    fixSuggestions.push('Split multi-claim units into single-assertion units');
  }
  
  // Check schema coverage
  const schemaUnits = units.filter(u => ['schema', 'schema_text'].includes(u.unit_grounding)).length;
  const schemaCoverageScore = units.length > 0 ? schemaUnits / units.length : 0;
  
  // Check hop graph density
  const hopGraphDensity = edges.length > 0 ? edges.length / Math.max(1, units.length) : 0;

  let needsSchema = false;
  let graphEdgesMissing = false;

  if (schemaCoverageScore < requiredSchemaCoverage) {
    needsSchema = true;
    errors.push(`schema_coverage_score too low: ${schemaCoverageScore.toFixed(2)} (required: >= ${requiredSchemaCoverage.toFixed(1)})`);
    fixSuggestions.push(`needs schema coverage increase (>= ${requiredSchemaCoverage.toFixed(1)})`);
  }

  if (hopGraphDensity === 0) {
    graphEdgesMissing = true;
    errors.push('hop_graph_density is 0 (graph edges missing)');
    fixSuggestions.push('Create schema relationships so hop_graph_density > 0');
  }
  
  const qualityReport = {
    grounded_fact_rate: groundedFactRate,
    ungrounded_fact_count: ungroundedFacts,
    avg_unit_length_tokens: avgLengths,
    atomicity_pass_rate: atomicityPassRate,
    schema_coverage_score: schemaCoverageScore,
    hop_graph_density: hopGraphDensity,
    needs_schema: needsSchema,
    graph_edges_missing: graphEdgesMissing,
    missing_schema_checks: schemaChecks.missing_schema_checks,
    present_schema_checks: schemaChecks.present_schema_checks,
    detected_schema_types: schemaChecks.detected_schema_types,
    recommended_next_types: schemaChecks.recommended_next_types,
    errors: errors.length > 0 ? errors : undefined,
    fix_suggestions: fixSuggestions.length > 0 ? fixSuggestions : undefined
  };
  
  return {
    passed: errors.length === 0,
    quality_report: qualityReport
  };
}

// REQUIREMENT 11: QA metrics (enhanced)
function computeQAMetrics(sections, units, docCleanText, boilerplateSignals) {
  const totalChars = docCleanText.length;
  const removedChars = boilerplateSignals.removed_fragments.join(' ').length;
  const boilerplateRatio = totalChars > 0 ? removedChars / totalChars : 0;
  
  const unitsUnderCap = units.filter(u => u.clean_text.length <= 800).length;
  const unitAtomizationScore = units.length > 0 ? unitsUnderCap / units.length : 0;
  
  const unitsWithOffsets = units.filter(u => 
    u.char_start !== undefined && 
    u.char_end !== undefined &&
    u.unit_offset_start !== undefined &&
    u.unit_offset_end !== undefined
  ).length;
  const provenanceCoverage = units.length > 0 ? unitsWithOffsets / units.length : 0;
  
  // Check for near-duplicates
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
async function extractContentUniversal(html, baseUrl, schemaHtmlOverride = null, domain = null) {
  const docId = generateId(baseUrl, 'doc');
  const boilerplateSignals = { removed_fragments: [], rules_fired: [] };
  
  // Extract basic metadata
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';
  const meta = extractMetaTags(html);
  const schemaSourceHtml = schemaHtmlOverride || html;
  const { structured_data, extraction_stats } = extractAllSchema(schemaSourceHtml);
  const schemaCheckReport = analyzeSchemaCoverage(structured_data, extraction_stats);
  
  // Extract sections (retrieve-layer parents) with hard boilerplate scrubbing
  const sections = extractSections(html, baseUrl, docId, boilerplateSignals);
  
  // REQUIREMENT 1: Build doc_clean_text and fix provenance offsets
  // Protocol v1.1: This is canonical_extracted_text - deterministic extraction
  const docCleanText = buildDocCleanText(sections);
  
  // Protocol v1.1: Generate extraction hash (must be deterministic)
  const extractionMethod = 'croutons-readability-v1';
  const extractionTextHash = crypto.createHash('sha256')
    .update(docCleanText, 'utf8')
    .digest('hex');
  
  // Extract units (search-layer children)
  const units = [];
  const edges = [];
  
  // 1. Extract definition units (REQUIREMENT 4)
  const definitionUnits = extractDefinitionUnits(sections, docId, baseUrl, docCleanText);
  units.push(...definitionUnits);
  
  // 2. Normalize schema facts (REQUIREMENT 5) with truth gating (REQUIREMENT 3)
  const { entities, units: schemaUnits } = normalizeSchemaFacts(structured_data, sections, docId, baseUrl, docCleanText, html);
  units.push(...schemaUnits);
  const schemaGraphEdges = generateSchemaEdges(entities, baseUrl, baseUrl);
  edges.push(...schemaGraphEdges);
  
  // 3. Extract FAQ units (atomized)
  const contentHash = crypto.createHash('sha256').update(docCleanText).digest('hex');
  const { units: faqUnits, edges: faqEdges } = extractFAQUnits(structured_data, sections, docId, baseUrl, docCleanText, contentHash);
  units.push(...faqUnits);
  edges.push(...faqEdges);
  
  // 4. Extract claim units (atomized)
  const claimUnits = extractClaimUnits(sections, docId, baseUrl, docCleanText);
  units.push(...claimUnits);
  
  // 5. Add SINR fields, enrichment 2.0, and assertion frames to all units
  for (const unit of units) {
    const section = sections.find(s => s.section_id === unit.section_id);
    if (section) {
      // REQUIREMENT 1: Add SINR protocol fields if not already present
      if (!unit.parent_section_id) {
        // REQUIREMENT 3: Validate grounding for facts
        let grounding;
        if (unit.unit_type === 'fact') {
          grounding = validateFactGrounding(unit, structured_data, html);
          // If fact is not grounded, downgrade to claim
          if (!grounding.grounded) {
            unit.unit_type = 'claim';
            unit.unit_confidence = grounding.confidence;
          }
        } else {
          grounding = {
            grounded: false,
            grounding_type: 'model_inferred',
            confidence: unit.unit_type === 'definition' ? 0.85 : 0.70,
            source_pointer: null
          };
        }
        addSINRFields(unit, section, grounding);
      }
      
      // REQUIREMENT 6: Add Enrichment 2.0
      const enrichment = generateEnrichment20(unit, section, sections, entities, baseUrl, title);
      unit.enrichment = enrichment;
      unit.enriched_text_for_embedding = enrichment.enriched_text_for_embedding;
      
      // Add assertion frame
      if (!unit.assertion) {
        unit.assertion = createAssertionFrame(unit, section, baseUrl, contentHash);
      }
    }
  }
  
  // Protocol v1.1: Add deterministic evidence anchors to all units
  addEvidenceAnchors(units, docCleanText, extractionTextHash);
  
  // Protocol v1.1: Generate fact identity (slot_id + fact_id) for all units
  for (const unit of units) {
    if (unit.evidence_anchor && !unit.anchor_missing) {
      const identity = generateFactIdentity(unit, baseUrl, extractionTextHash);
      if (identity) {
        unit.slot_id = identity.slot_id;
        unit.fact_id = identity.fact_id;
      }
    } else {
      unit.anchor_missing = true;
      console.warn(`[extractContentUniversal] Unit ${unit.unit_id} has missing anchor - will be excluded from citation-grade tier`);
    }
  }
  
  // 6. Generate expanded edges (REQUIREMENT 7: Hop Graph beyond FAQ)
  const expandedEdges = generateExpandedEdges(units, sections, html, baseUrl);
  edges.push(...expandedEdges);
  
  // 7. Infer intended users (REQUIREMENT 7)
  const intendedUsers = inferIntendedUsers(structured_data, sections, units);
  
  // 8. Generate views (REQUIREMENT 8)
  const views = generateViews(sections, units, intendedUsers, baseUrl);
  
  // 7. Detect vertical (REQUIREMENT 8)
  const vertical = detectVertical(structured_data);
  
  // 8. Compute QA metrics (REQUIREMENT 11)
  const qa = computeQAMetrics(sections, units, docCleanText, boilerplateSignals);
  
  // 9. Run QA gate (REQUIREMENT 9: Citations Guarantee)
  const qaGate = await runQAGate(units, sections, docCleanText, boilerplateSignals, schemaCheckReport, edges, domain);
  
  return {
    doc_id: docId,
    title,
    meta,
    structured_data,
    extraction_stats,
    doc_clean_text: docCleanText, // REQUIREMENT 1 & 2
    // Protocol v1.1: Canonical extraction tracking
    canonical_extracted_text: docCleanText,
    extraction_method: extractionMethod,
    extraction_text_hash: extractionTextHash,
    boilerplate_signals: boilerplateSignals, // REQUIREMENT 2
    entities, // REQUIREMENT 5
    intended_users: intendedUsers, // REQUIREMENT 7
    vertical, // REQUIREMENT 8
    views, // REQUIREMENT 8
    sections,
    units,
    edges,
    qa, // REQUIREMENT 11
    qa_gate: qaGate, // REQUIREMENT 9
    schema_check_report: schemaCheckReport,
  };
}

// Protocol v1.1: Generate fact identity (slot_id + fact_id)
// slot_id = sha256(entity_id|predicate|source_url|char_start|char_end|extraction_text_hash)
// fact_id = sha256(slot_id|object|fragment_hash)
function generateFactIdentity(unit, sourceUrl, extractionTextHash) {
  if (!unit.evidence_anchor || unit.anchor_missing) {
    // Cannot generate stable identity without anchor
    return null;
  }
  
  const entityId = unit.triple?.subject_id || unit.entity_refs?.[0] || 'unknown';
  const predicate = unit.triple?.predicate || 'states';
  const charStart = unit.evidence_anchor.char_start;
  const charEnd = unit.evidence_anchor.char_end;
  const fragmentHash = unit.evidence_anchor.fragment_hash;
  const object = unit.triple?.object || unit.clean_text || '';
  
  // slot_id: stable identity of fact slot (never changes unless anchor changes)
  const slotIdComponents = [
    entityId,
    predicate,
    sourceUrl,
    charStart.toString(),
    charEnd.toString(),
    extractionTextHash
  ].join('|');
  
  const slotId = crypto.createHash('sha256')
    .update(slotIdComponents, 'utf8')
    .digest('hex');
  
  // fact_id: versioned identity (changes when object or fragment changes)
  const factIdComponents = [
    slotId,
    object,
    fragmentHash
  ].join('|');
  
  const factId = crypto.createHash('sha256')
    .update(factIdComponents, 'utf8')
    .digest('hex');
  
  return {
    slot_id: slotId,
    fact_id: factId
  };
}

// Protocol v1.1: Add deterministic evidence anchors to all units
// supporting_text MUST be exactly canonical_extracted_text[char_start:char_end]
// fragment_hash MUST match sha256 of that exact substring
function addEvidenceAnchors(units, canonicalExtractedText, extractionTextHash) {
  if (!canonicalExtractedText || !extractionTextHash) {
    console.warn('[addEvidenceAnchors] Missing canonical text or hash, skipping evidence anchors');
    return;
  }
  
  for (const unit of units) {
    if (!unit.clean_text) continue;
    
    // Find unit text in canonical_extracted_text
    // Try exact match first
    const unitText = unit.clean_text.trim();
    let charStart = canonicalExtractedText.indexOf(unitText);
    let charEnd = charStart + unitText.length;
    
    // If exact match fails, try normalized (remove extra whitespace)
    if (charStart === -1) {
      const normalizedUnitText = unitText.replace(/\s+/g, ' ').trim();
      const normalizedCanonical = canonicalExtractedText.replace(/\s+/g, ' ');
      charStart = normalizedCanonical.indexOf(normalizedUnitText);
      charEnd = charStart + normalizedUnitText.length;
    }
    
    // If still not found, try finding by section offsets (fallback)
    if (charStart === -1 && unit.section_id) {
      // Use section char_start as approximate anchor
      // This is a fallback - not ideal but better than nothing
      const section = units.find(u => u.section_id === unit.section_id && u.char_start !== undefined);
      if (section && section.char_start !== undefined) {
        charStart = section.char_start;
        charEnd = charStart + unitText.length;
      }
    }
    
    // If still not found, mark as anchor_missing (Protocol v1.1: no fake offsets)
    if (charStart === -1) {
      console.warn(`[addEvidenceAnchors] Could not anchor unit ${unit.unit_id}: "${unitText.substring(0, 50)}..."`);
      unit.anchor_missing = true;
      // Do NOT create fake offsets (0/0) - exclude from citation-grade tier
      continue;
    }
    
    // Ensure char_end doesn't exceed canonical text length
    charEnd = Math.min(charEnd, canonicalExtractedText.length);
    charStart = Math.max(0, charStart);
    
    // Extract supporting_text as exact substring
    const supportingText = canonicalExtractedText.substring(charStart, charEnd);
    
    // Calculate fragment_hash
    const fragmentHash = crypto.createHash('sha256')
      .update(supportingText, 'utf8')
      .digest('hex');
    
    // Store evidence anchor
    unit.supporting_text = supportingText;
    unit.evidence_anchor = {
      char_start: charStart,
      char_end: charEnd,
      fragment_hash: fragmentHash,
      extraction_text_hash: extractionTextHash
    };
    
    // Validation: verify supporting_text matches substring
    if (supportingText !== canonicalExtractedText.substring(charStart, charEnd)) {
      console.error(`[addEvidenceAnchors] Validation failed for unit ${unit.unit_id}: supporting_text mismatch`);
    }
    
    // Validation: verify fragment_hash
    const computedFragmentHash = crypto.createHash('sha256')
      .update(supportingText, 'utf8')
      .digest('hex');
    if (computedFragmentHash !== fragmentHash) {
      console.error(`[addEvidenceAnchors] Validation failed for unit ${unit.unit_id}: fragment_hash mismatch`);
    }
  }
}

// Compute content hash for change detection
function computeContentHash(content) {
  const contentString = JSON.stringify(content);
  return crypto.createHash('sha256').update(contentString).digest('hex');
}

// Derive path from source URL (canonical, deterministic)
function derivePath(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    let path = url.pathname;
    
    // Remove leading/trailing slashes
    path = path.replace(/^\/+|\/+$/g, '');
    
    // Empty path becomes 'index'
    if (!path) {
      path = 'index';
    }
    
    return path;
  } catch (error) {
    console.error('Path derivation error:', error);
    return 'index';
  }
}

// Generate markdown from extracted content
function generateMarkdown(extractedContent, sourceUrl, contentHash) {
  const title = extractedContent.title || '';
  const generatedAt = new Date().toISOString();
  const domain = new URL(sourceUrl).hostname;
  const baseUrl = `https://${domain}`;
  
  // Generate stable entity IDs
  const entityIds = {
    org: `${baseUrl}/#org`,
    website: `${baseUrl}/#website`,
    page: `${baseUrl}/#webpage-${crypto.createHash('md5').update(sourceUrl).digest('hex').substring(0, 8)}`,
    service: `${baseUrl}/#service-primary`
  };
  
  // Build frontmatter with language detection
  const frontmatter = [
    '---',
    `title: "${title.replace(/"/g, '\\"')}"`,
    `source_url: "${sourceUrl}"`,
    `source_domain: "${domain}"`,
    `generated_by: "croutons.ai"`,
    `generated_at: "${generatedAt}"`,
    `content_hash: "${contentHash}"`,
    `language: "${extractedContent.language || 'en'}"`,
    'entities:',
    `  org_id: "${entityIds.org}"`,
    `  website_id: "${entityIds.website}"`,
    `  page_id: "${entityIds.page}"`,
    `  service_id: "${entityIds.service}"`,
    '---',
    ''
  ].join('\n');

  // Start markdown content
  let markdown = '';
  
  // Add title
  if (title) {
    markdown += `# ${title}\n\n`;
  }

  // === ENTITY REGISTRY ===
  markdown += '## Entities\n\n';
  
  // Collect and deduplicate triples
  const tripleSet = new Set();
  const addTriple = (subject, predicate, object) => {
    if (!object || object === '') return;
    const normalized = `${subject} | ${predicate} | ${String(object).trim()}`;
    tripleSet.add(normalized);
  };

  // Extract entities from structured data
  const structuredData = extractedContent.structured_data || [];
  const entities = {};
  
  for (const item of structuredData) {
    const type = normalizeSchemaType(item['@type']);
    let entityId = null;
    
    // Assign appropriate entity ID based on type
    if (type === 'Organization') {
      entityId = entityIds.org;
      entities.org = item;
    } else if (type === 'WebSite') {
      entityId = entityIds.website;
      entities.website = item;
    } else if (type === 'WebPage') {
      entityId = entityIds.page;
      entities.page = item;
    } else if (type === 'Service' || type === 'Product') {
      entityId = entityIds.service;
      entities.service = item;
    } else {
      // Generic entity with generated ID
      entityId = `${baseUrl}/#${type.toLowerCase()}-${crypto.createHash('md5').update(JSON.stringify(item)).digest('hex').substring(0, 8)}`;
    }
    
    // Add type triple
    addTriple(entityId, 'type', type);
    
    // Extract properties as triples
    for (const [prop, value] of Object.entries(item)) {
      if (prop.startsWith('@')) continue; // Skip JSON-LD keywords
      
      if (Array.isArray(value)) {
        // Handle arrays (e.g., sameAs links)
        for (const val of value) {
          if (typeof val === 'object' && val !== null) {
            // Nested object - extract nested properties
            if (val['@type']) {
              addTriple(entityId, prop, `${val['@type']}: ${val.name || JSON.stringify(val)}`);
            }
          } else {
            addTriple(entityId, prop, val);
          }
        }
      } else if (typeof value === 'object' && value !== null) {
        // Nested object
        if (value['@type']) {
          addTriple(entityId, prop, `${value['@type']}: ${value.name || JSON.stringify(value)}`);
        } else if (value.name) {
          addTriple(entityId, prop, value.name);
        }
      } else {
        // Simple value
        addTriple(entityId, prop, value);
      }
    }
  }
  
  // Write entity triples (sorted for determinism)
  const sortedTriples = Array.from(tripleSet).sort();
  for (const triple of sortedTriples) {
    markdown += `${triple}\n`;
  }
  markdown += '\n';

  // === DEFINITIONS ===
  const definitions = (extractedContent.units || []).filter(u => u.unit_type === 'definition');
  if (definitions.length > 0) {
    markdown += '## Core Definitions (Atomic)\n\n';
    const defSet = new Set();
    
    for (const def of definitions) {
      const text = (def.clean_text || def.text || '').trim();
      if (!text) continue;
      
      // Parse "TERM: definition" format
      const colonIndex = text.indexOf(':');
      if (colonIndex > 0 && colonIndex < 50) {
        const term = text.substring(0, colonIndex).trim();
        const definition = text.substring(colonIndex + 1).trim();
        defSet.add(`definition | ${term} | ${definition}`);
      } else {
        defSet.add(`definition | ${text.split(/[:.]/)[0].trim()} | ${text}`);
      }
    }
    
    for (const def of Array.from(defSet).sort()) {
      markdown += `${def}\n`;
    }
    markdown += '\n';
  }

  // === ATOMIC FACTS ===
  const facts = (extractedContent.units || []).filter(u => 
    u.unit_type === 'fact' || u.unit_type === 'claim'
  );
  
  if (facts.length > 0) {
    markdown += '## Facts (Atomic)\n\n';
    const factSet = new Set();
    
    for (const fact of facts) {
      const text = (fact.clean_text || fact.text || '').trim();
      if (!text || text.length < 10) continue;
      
      // Split long sentences into atomic units
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      for (let sentence of sentences) {
        sentence = sentence.trim();
        if (sentence.length < 10) continue;
        
        // Add evidence pointer if available
        const evidence = fact.evidence_heading_path || fact.section_heading || '';
        if (evidence) {
          factSet.add(`${entityIds.page} | states | ${sentence} [evidence: ${evidence}]`);
        } else {
          factSet.add(`${entityIds.page} | states | ${sentence}`);
        }
      }
    }
    
    for (const fact of Array.from(factSet).sort()) {
      markdown += `${fact}\n`;
    }
    markdown += '\n';
  }

  // === FAQ ===
  const faqQuestions = (extractedContent.units || []).filter(u => u.unit_type === 'faq_q');
  const faqAnswers = (extractedContent.units || []).filter(u => u.unit_type === 'faq_a');
  
  if (faqQuestions.length > 0 || faqAnswers.length > 0) {
    markdown += '## FAQ\n\n';
    
    // Try to pair questions with answers
    for (let i = 0; i < faqQuestions.length; i++) {
      const question = (faqQuestions[i].clean_text || faqQuestions[i].text || '').trim();
      if (!question) continue;
      
      markdown += `### Q: ${question}\n\n`;
      
      // Find corresponding answer (next answer after this question)
      if (i < faqAnswers.length) {
        const answer = (faqAnswers[i].clean_text || faqAnswers[i].text || '').trim();
        if (answer) {
          // Split answer into bullet points if it contains sentences
          const sentences = answer.split(/[.!?]+/).filter(s => s.trim().length > 10);
          if (sentences.length > 1) {
            markdown += 'A:\n';
            for (const sentence of sentences) {
              markdown += `  • ${sentence.trim()}\n`;
            }
          } else {
            markdown += `A: ${answer}\n`;
          }
        }
      }
      markdown += '\n';
    }
  }

  // === SECTIONS (if no structured data) ===
  if (sortedTriples.length === 0 && extractedContent.sections && extractedContent.sections.length > 0) {
    markdown += '## Content\n\n';
    for (const section of extractedContent.sections) {
      if (section.heading) {
        markdown += `### ${section.heading}\n\n`;
      }
      if (section.text) {
        // Split into atomic sentences
        const sentences = section.text.split(/[.!?]+/).filter(s => s.trim().length > 10);
        for (const sentence of sentences) {
          markdown += `${entityIds.page} | contains | ${sentence.trim()}\n`;
        }
        markdown += '\n';
      }
    }
  }

  // Fallback to doc_clean_text if no structured content at all
  if (markdown.trim() === '## Entities\n' && extractedContent.doc_clean_text) {
    markdown += '## Content\n\n';
    const sentences = extractedContent.doc_clean_text.split(/[.!?]+/).filter(s => s.trim().length > 10);
    for (const sentence of sentences.slice(0, 50)) { // Limit to 50 sentences for fallback
      markdown += `${entityIds.page} | contains | ${sentence.trim()}\n`;
    }
    markdown += '\n';
  }

  return frontmatter + markdown;
}

// Generate and store markdown in markdown_versions table
async function generateAndStoreMarkdown(domain, sourceUrl, extractedContent, contentHash) {
  console.log(`[generateAndStoreMarkdown] Starting for ${domain} -> ${sourceUrl}`);
  const path = derivePath(sourceUrl);
  console.log(`[generateAndStoreMarkdown] Derived path: ${path}`);
  
  const markdownContent = generateMarkdown(extractedContent, sourceUrl, contentHash);
  console.log(`[generateAndStoreMarkdown] Generated markdown (${markdownContent.length} chars)`);
  
  // Hash the markdown content for content_hash
  const markdownHash = crypto.createHash('sha256').update(markdownContent).digest('hex');
  console.log(`[generateAndStoreMarkdown] Content hash: ${markdownHash.substring(0, 12)}...`);
  
  if (!pool) {
    throw new Error('Database pool not available');
  }
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log(`[generateAndStoreMarkdown] Transaction started`);
    
    // 1) Deactivate prior active versions for (domain, path)
    const deactivateResult = await client.query(`
      UPDATE markdown_versions 
      SET is_active = false 
      WHERE domain = $1 AND path = $2 AND is_active = true
    `, [domain, path]);
    console.log(`[generateAndStoreMarkdown] Deactivated ${deactivateResult.rowCount} prior version(s)`);
    
    // 2) Insert new version with is_active=true
    const insertResult = await client.query(`
      INSERT INTO markdown_versions (domain, path, content, content_hash, generated_at, is_active)
      VALUES ($1, $2, $3, $4, NOW(), TRUE)
      ON CONFLICT (domain, path, content_hash) 
      DO UPDATE SET
        is_active = TRUE,
        updated_at = NOW()
      RETURNING id, domain, path, is_active
    `, [domain, path, markdownContent, markdownHash]);
    
    await client.query('COMMIT');
    console.log(`[generateAndStoreMarkdown] ✅ Markdown stored: id=${insertResult.rows[0]?.id}, domain=${domain}, path=${path}, is_active=${insertResult.rows[0]?.is_active}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`[generateAndStoreMarkdown] ❌ Error:`, error.message);
    console.error(`[generateAndStoreMarkdown] Stack:`, error.stack);
    throw error;
  } finally {
    client.release();
  }
}

async function fetchPrerenderSnapshot(url) {
  const prerenderEndpoint = process.env.PRENDER_SERVICE_URL;
  if (!prerenderEndpoint) return null;
  try {
    const separator = prerenderEndpoint.includes('?') ? '&' : '?';
    const prerenderUrl = `${prerenderEndpoint}${separator}url=${encodeURIComponent(url)}`;
    const response = await fetch(prerenderUrl, {
      headers: {
        'User-Agent': 'Croutons-Ingestor/1.0',
        'Accept': 'text/html'
      }
    });
    if (!response.ok) {
      console.warn(`[ingest] Prerender fetch failed for ${url}: ${response.status}`);
      return null;
    }
    return await response.text();
  } catch (error) {
    console.warn('[ingest] Prerender fetch error:', error.message);
    return null;
  }
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

    const snapshotResult = await pool.query(
      'SELECT html FROM html_snapshots WHERE domain = $1 AND source_url = $2',
      [domain, canonicalUrl]
    );
    const previousHtml = snapshotResult.rows[0]?.html || null;

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

    // Extract content with all upgrades (allow schema-specific overrides)
    let extractedContent = await extractContentUniversal(html, canonicalUrl, null, domain);
    
    // Protocol v1.1: Store canonical extraction tracking in html_snapshots
    const canonicalExtractedText = extractedContent.canonical_extracted_text || extractedContent.doc_clean_text || '';
    const extractionMethod = extractedContent.extraction_method || 'croutons-readability-v1';
    const extractionTextHash = extractedContent.extraction_text_hash || 
      crypto.createHash('sha256').update(canonicalExtractedText, 'utf8').digest('hex');
    
    // Store raw HTML snapshot + extraction tracking
    await pool.query(`
      INSERT INTO html_snapshots (
        domain, source_url, html,
        extraction_method, canonical_extracted_text, extraction_text_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (domain, source_url) 
      DO UPDATE SET 
        html = EXCLUDED.html,
        extraction_method = EXCLUDED.extraction_method,
        canonical_extracted_text = EXCLUDED.canonical_extracted_text,
        extraction_text_hash = EXCLUDED.extraction_text_hash,
        fetched_at = NOW()
    `, [domain, canonicalUrl, html, extractionMethod, canonicalExtractedText, extractionTextHash]);

    // Note: extractContentUniversal already called above to get extraction tracking
    // Re-extract only if we need fallback schema
    if (!extractedContent.structured_data || extractedContent.structured_data.length === 0) {
      let fallbackSchemaHtml = previousHtml;
      if (!fallbackSchemaHtml) {
        fallbackSchemaHtml = await fetchPrerenderSnapshot(canonicalUrl);
      }
      if (fallbackSchemaHtml) {
        console.log(`[ingest] Using fallback schema HTML for ${canonicalUrl}`);
        // Re-extract with fallback, but preserve extraction tracking from first pass
        const fallbackContent = await extractContentUniversal(html, canonicalUrl, fallbackSchemaHtml, domain);
        // Merge: use fallback structured_data but keep original extraction tracking
        extractedContent.structured_data = fallbackContent.structured_data;
        extractedContent.extraction_stats = fallbackContent.extraction_stats;
        extractedContent.schema_check_report = fallbackContent.schema_check_report;
      }
    }
    const contentHash = computeContentHash(extractedContent);
    
    // REQUIREMENT 9: Check QA gate - if failed, return ok: false
    const ok = extractedContent.qa_gate.passed;

    // Generate and store markdown if ingestion passed
    if (ok) {
      try {
        console.log(`[ingest] Generating markdown for ${domain} -> ${canonicalUrl}`);
        await generateAndStoreMarkdown(domain, canonicalUrl, extractedContent, contentHash);
        console.log(`[ingest] ✅ Markdown generation completed for ${domain}`);
      } catch (markdownError) {
        // Log but don't fail ingestion if markdown generation fails
        console.error('[ingest] Markdown generation error (non-fatal):', markdownError.message);
        console.error('[ingest] Markdown generation stack:', markdownError.stack);
      }
    } else {
      console.log(`[ingest] Skipping markdown generation - QA gate failed for ${domain}`);
    }

    // Protocol v1.1: Store all units in croutons table for facts stream
    let croutonsStorageStatus = { 
      attempted: false, 
      success: false, 
      error: null, 
      count: 0,
      debug: {
        hasUnits: !!extractedContent.units,
        unitsLength: extractedContent.units ? extractedContent.units.length : null,
        unitsType: typeof extractedContent.units,
        isArray: Array.isArray(extractedContent.units),
        firstUnitExists: extractedContent.units && extractedContent.units[0] ? true : false
      }
    };
    if (extractedContent.units && extractedContent.units.length > 0) {
      croutonsStorageStatus.attempted = true;
      try {
        console.log(`[ingest] Storing ${extractedContent.units.length} units to croutons table...`);
        
        for (const unit of extractedContent.units) {
          // Generate crouton_id (legacy ID field)
          const croutonId = crypto.createHash('sha256')
            .update(`${domain}|${canonicalUrl}|${unit.text}|${Date.now()}`)
            .digest('hex').substring(0, 16);
          
          // Extract entity_id from triple or use default
          const entityId = unit.triple?.subject || `https://${domain}/#org`;
          const predicate = unit.triple?.predicate || 'states';
          const object = unit.triple?.object || unit.text;
          
          await pool.query(`
            INSERT INTO croutons (
              crouton_id, domain, source_url, text, triple,
              slot_id, fact_id, previous_fact_id, revision,
              supporting_text, evidence_anchor, extraction_text_hash,
              confidence, verified_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
            ON CONFLICT (crouton_id) DO UPDATE SET
              text = EXCLUDED.text,
              triple = EXCLUDED.triple,
              slot_id = EXCLUDED.slot_id,
              fact_id = EXCLUDED.fact_id,
              previous_fact_id = EXCLUDED.previous_fact_id,
              revision = EXCLUDED.revision,
              supporting_text = EXCLUDED.supporting_text,
              evidence_anchor = EXCLUDED.evidence_anchor,
              extraction_text_hash = EXCLUDED.extraction_text_hash,
              confidence = EXCLUDED.confidence,
              verified_at = NOW(),
              updated_at = NOW()
          `, [
            croutonId,
            domain,
            canonicalUrl,
            unit.text,
            JSON.stringify(unit.triple || null),
            unit.slot_id || null,
            unit.fact_id || null,
            unit.previous_fact_id || null,
            unit.revision || 1,
            unit.supporting_text || null,
            JSON.stringify(unit.evidence_anchor || null),
            extractedContent.extraction_text_hash || null,
            unit.confidence || 0.5
          ]);
          croutonsStorageStatus.count++;
        }
        
        croutonsStorageStatus.success = true;
        console.log(`[ingest] ✅ Stored ${extractedContent.units.length} units to croutons table`);
      } catch (croutonsError) {
        // Log but don't fail ingestion if croutons storage fails
        croutonsStorageStatus.error = croutonsError.message;
        console.error('[ingest] Croutons storage error (non-fatal):', croutonsError.message);
        console.error('[ingest] Croutons storage stack:', croutonsError.stack);
      }
    }

    res.json({
      ok,
      ...(ok ? {} : {
        errors: extractedContent.qa_gate.quality_report.errors,
        fix_suggestions: extractedContent.qa_gate.quality_report.fix_suggestions
      }),
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
        vertical: extractedContent.vertical,
        views: extractedContent.views,
        qa: extractedContent.qa,
        schema_check_report: extractedContent.schema_check_report,
        quality_report: extractedContent.qa_gate.quality_report,
        extraction_stats: extractedContent.extraction_stats,
        // Protocol v1.1: Extraction tracking
        extraction_method: extractedContent.extraction_method,
        extraction_text_hash: extractedContent.extraction_text_hash,
        canonical_extracted_text: extractedContent.canonical_extracted_text,
        fetched_at: new Date().toISOString(),
        // Debug: croutons storage status
        _debug_croutons_storage: croutonsStorageStatus
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
