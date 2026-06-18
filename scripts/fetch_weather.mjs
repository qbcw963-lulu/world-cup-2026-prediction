import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv, writeCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schedule = readCsv(path.join(root, 'data', 'world_cup_2026_schedule_104_matches.csv'));
const venues = readCsv(path.join(root, 'data', 'venues_2026.csv'));
const contextPath = path.join(root, 'data', 'match_context_2026.csv');
const contexts = readCsv(contextPath);
const venueByName = new Map(venues.map((venue) => [venue.venue, venue]));
const matchById = new Map(schedule.map((match) => [match.match_id, match]));

function offsetForZone(zone) {
  if (zone === 'ET') return '-04:00';
  const match = zone.match(/^UTC([+-]\d+)$/);
  if (!match) return 'Z';
  const hours = Number(match[1]);
  return `${hours >= 0 ? '+' : '-'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
}

function kickoffDate(match) {
  return new Date(`${match.date}T${match.time || '12:00'}:00${offsetForZone(match.time_zone)}`);
}

const forecasts = new Map();
for (const venue of venues) {
  const query = new URLSearchParams({
    latitude: venue.latitude,
    longitude: venue.longitude,
    hourly: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m',
    forecast_days: '16',
    past_days: '7',
    timezone: 'UTC',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`);
  if (!response.ok) continue;
  forecasts.set(venue.venue, await response.json());
}

for (const context of contexts) {
  const match = matchById.get(context.match_id);
  if (!match) continue;
  const forecast = forecasts.get(match.venue);
  if (!forecast?.hourly?.time) continue;
  const kickoff = kickoffDate(match).getTime();
  let bestIndex = -1;
  let bestDifference = Infinity;
  forecast.hourly.time.forEach((time, index) => {
    const difference = Math.abs(new Date(`${time}Z`).getTime() - kickoff);
    if (difference < bestDifference) {
      bestDifference = difference;
      bestIndex = index;
    }
  });
  if (bestIndex === -1 || bestDifference > 2 * 3600000) continue;
  context.temperature_c = forecast.hourly.temperature_2m[bestIndex];
  context.humidity_pct = forecast.hourly.relative_humidity_2m[bestIndex];
  context.wind_kph = forecast.hourly.wind_speed_10m[bestIndex];
  context.precipitation_mm = forecast.hourly.precipitation[bestIndex];
  context.weather_forecast_time = forecast.hourly.time[bestIndex];
  context.weather_status = match.status === 'finished'
    ? 'open_meteo_recent_hourly'
    : 'open_meteo_forecast';
  const heatPenalty = Number(context.temperature_c) >= 30 ? -0.06 : 0;
  const rainPenalty = Number(context.precipitation_mm) >= 2 ? -0.05 : 0;
  const windPenalty = Number(context.wind_kph) >= 25 ? -0.04 : 0;
  context.weather_goal_adjustment = (heatPenalty + rainPenalty + windPenalty).toFixed(3);
  context.source_urls = [context.source_urls, 'https://open-meteo.com/']
    .filter(Boolean).join('; ');
  context.verified_at = new Date().toISOString();
}

writeCsv(contextPath, Object.keys(contexts[0]), contexts);
console.log(`Weather refreshed for ${contexts.filter((row) => row.weather_status === 'open_meteo_forecast').length} matches.`);
