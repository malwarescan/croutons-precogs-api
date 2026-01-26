/**
 * Environmental Local Climate Domain Client
 * 
 * Provides Precogs with easy access to environmental.local_climate factlets
 * from the Croutons Graph.
 * 
 * @module environmental-climate-client
 */

const DOMAIN = 'environmental.local_climate';

/**
 * Query environmental climate data from Croutons Graph
 * 
 * @param {Object} graphClient - Croutons graph client instance
 * @param {Object} filters - Query filters
 * @param {string} [filters.zip] - ZIP code filter
 * @param {string} [filters.county] - County name filter
 * @param {string} [filters.dateStart] - Start date (YYYY-MM-DD)
 * @param {string} [filters.dateEnd] - End date (YYYY-MM-DD)
 * @param {string} [filters.stormEvent] - Storm event type filter
 * @param {number} [filters.lat] - Latitude (for proximity search)
 * @param {number} [filters.lon] - Longitude (for proximity search)
 * @param {number} [filters.radiusMiles] - Search radius in miles (requires lat/lon)
 * @param {number} [filters.limit=100] - Maximum results to return
 * @returns {Promise<Array>} Array of climate data factlets
 */
async function queryClimateData(graphClient, filters = {}) {
  const {
    zip,
    county,
    dateStart,
    dateEnd,
    stormEvent,
    lat,
    lon,
    radiusMiles,
    limit = 100
  } = filters;

  // Build query parameters
  const params = {
    corpus: DOMAIN,
    limit
  };

  // Add location filters
  if (zip) {
    params.q = zip;
  } else if (county) {
    params.q = county;
  } else if (stormEvent) {
    params.q = stormEvent;
  }

  try {
    const response = await graphClient.query(params);
    let results = response.results || [];

    // Post-filter by date range if specified
    if (dateStart || dateEnd) {
      results = results.filter(item => {
        const normalized = item.normalized || {};
        const itemDate = normalized.date;
        if (!itemDate) return false;

        if (dateStart && itemDate < dateStart) return false;
        if (dateEnd && itemDate > dateEnd) return false;
        return true;
      });
    }

    // Post-filter by proximity if lat/lon specified
    if (lat !== undefined && lon !== undefined && radiusMiles) {
      results = results.filter(item => {
        const normalized = item.normalized || {};
        if (!normalized.lat || !normalized.lon) return false;

        const distance = calculateDistance(lat, lon, normalized.lat, normalized.lon);
        return distance <= radiusMiles;
      });
    }

    return results;
  } catch (error) {
    console.error('[environmental-climate] Query error:', error);
    throw error;
  }
}

/**
 * Get climate summary for a location
 * 
 * @param {Object} graphClient - Croutons graph client instance
 * @param {string} zip - ZIP code
 * @param {string} dateStart - Start date (YYYY-MM-DD)
 * @param {string} dateEnd - End date (YYYY-MM-DD)
 * @returns {Promise<Object>} Climate summary statistics
 */
async function getClimateSummary(graphClient, zip, dateStart, dateEnd) {
  const data = await queryClimateData(graphClient, {
    zip,
    dateStart,
    dateEnd,
    limit: 1000
  });

  if (data.length === 0) {
    return null;
  }

  // Calculate summary statistics
  const temps = [];
  const precip = [];
  const humidity = [];
  const storms = [];

  data.forEach(item => {
    const n = item.normalized || {};
    if (n.temp_max !== undefined) temps.push(n.temp_max);
    if (n.precipitation !== undefined) precip.push(n.precipitation);
    if (n.humidity_index !== undefined) humidity.push(n.humidity_index);
    if (n.storm_event && n.storm_event !== 'none') {
      storms.push({
        date: n.date,
        event: n.storm_event,
        intensity: n.storm_intensity
      });
    }
  });

  return {
    zip,
    dateRange: { start: dateStart, end: dateEnd },
    recordCount: data.length,
    temperature: {
      max: temps.length > 0 ? Math.max(...temps) : null,
      min: temps.length > 0 ? Math.min(...temps) : null,
      avg: temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null
    },
    precipitation: {
      total: precip.reduce((a, b) => a + b, 0),
      max: precip.length > 0 ? Math.max(...precip) : null,
      daysWithRain: precip.filter(p => p > 0).length
    },
    humidity: {
      avg: humidity.length > 0 ? humidity.reduce((a, b) => a + b, 0) / humidity.length : null,
      max: humidity.length > 0 ? Math.max(...humidity) : null
    },
    storms: {
      count: storms.length,
      events: storms
    }
  };
}

/**
 * Get recent storm events for a location
 * 
 * @param {Object} graphClient - Croutons graph client instance
 * @param {string} zip - ZIP code
 * @param {number} [days=30] - Number of days to look back
 * @returns {Promise<Array>} Recent storm events
 */
async function getRecentStorms(graphClient, zip, days = 30) {
  const dateEnd = new Date().toISOString().split('T')[0];
  const dateStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const data = await queryClimateData(graphClient, {
    zip,
    dateStart,
    dateEnd,
    limit: 500
  });

  return data
    .filter(item => {
      const n = item.normalized || {};
      return n.storm_event && n.storm_event !== 'none';
    })
    .map(item => ({
      date: item.normalized.date,
      event: item.normalized.storm_event,
      intensity: item.normalized.storm_intensity,
      description: item.claim
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Calculate distance between two lat/lon points (Haversine formula)
 * 
 * @param {number} lat1 - Latitude 1
 * @param {number} lon1 - Longitude 1
 * @param {number} lat2 - Latitude 2
 * @param {number} lon2 - Longitude 2
 * @returns {number} Distance in miles
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 3959; // Earth's radius in miles
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Validate environmental climate data against schema
 * 
 * @param {Object} data - Climate data object
 * @returns {Object} Validation result { valid: boolean, errors: Array }
 */
function validateClimateData(data) {
  const errors = [];

  // Required fields
  if (!data.date) {
    errors.push('Missing required field: date');
  }
  if (!data.source) {
    errors.push('Missing required field: source');
  }

  // Validate date format
  if (data.date && !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
    errors.push('Invalid date format (expected YYYY-MM-DD)');
  }

  // Validate temperature ranges
  if (data.temp_max !== undefined && (data.temp_max < -100 || data.temp_max > 150)) {
    errors.push('temp_max out of valid range (-100 to 150°F)');
  }
  if (data.temp_min !== undefined && (data.temp_min < -100 || data.temp_min > 150)) {
    errors.push('temp_min out of valid range (-100 to 150°F)');
  }

  // Validate humidity
  if (data.humidity_index !== undefined && (data.humidity_index < 0 || data.humidity_index > 100)) {
    errors.push('humidity_index out of valid range (0 to 100)');
  }

  // Validate coordinates
  if (data.lat !== undefined && (data.lat < -90 || data.lat > 90)) {
    errors.push('lat out of valid range (-90 to 90)');
  }
  if (data.lon !== undefined && (data.lon < -180 || data.lon > 180)) {
    errors.push('lon out of valid range (-180 to 180)');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

module.exports = {
  DOMAIN,
  queryClimateData,
  getClimateSummary,
  getRecentStorms,
  validateClimateData,
  calculateDistance
};
