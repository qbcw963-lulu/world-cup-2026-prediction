import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv, writeCsv } from './lib/csv.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const schedule = readCsv(path.join(root, 'data', 'world_cup_2026_schedule_104_matches.csv'));
const venues = readCsv(path.join(root, 'data', 'venues_2026.csv'));
const standings = readCsv(path.join(root, 'data', 'world_cup_2026_standings_2026-06-18.csv'));
const referees = readCsv(path.join(root, 'data', 'referees_2026.csv'));
const availability = readCsv(path.join(root, 'data', 'player_availability_2026.csv'));
const venueByName = new Map(venues.map((venue) => [venue.venue, venue]));
const standingByTeam = new Map(standings.map((standing) => [standing.team, standing]));

const teamAliases = new Map([
  ['south korea', ['south korea', 'korea republic']],
  ['united states', ['united states', 'usa']],
  ['dr congo', ['dr congo', 'congo dr']],
  ['ivory coast', ['ivory coast', "côte d'ivoire", 'cote divoire']],
  ['cabo verde', ['cabo verde', 'cape verde']],
  ['türkiye', ['türkiye', 'turkey']],
]);

function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function assignmentHasTeam(assignment, team) {
  const normalized = normalize(assignment);
  const aliases = teamAliases.get(normalize(team)) ?? [normalize(team)];
  return aliases.some((alias) => normalized.includes(normalize(alias)));
}

function assignedReferee(match) {
  return referees.find((referee) =>
    referee.matches_assigned &&
    assignmentHasTeam(referee.matches_assigned, match.home) &&
    assignmentHasTeam(referee.matches_assigned, match.away));
}

function offsetForZone(zone) {
  if (zone === 'ET') return '-04:00';
  const match = zone.match(/^UTC([+-]\d+)$/);
  if (!match) return 'Z';
  const hours = Number(match[1]);
  return `${hours >= 0 ? '+' : '-'}${String(Math.abs(hours)).padStart(2, '0')}:00`;
}

function kickoffDate(match) {
  if (!match.time) return new Date(`${match.date}T12:00:00Z`);
  return new Date(`${match.date}T${match.time}:00${offsetForZone(match.time_zone)}`);
}

function haversineKm(a, b) {
  if (!a || !b) return 0;
  const rad = (value) => value * Math.PI / 180;
  const dLat = rad(Number(b.latitude) - Number(a.latitude));
  const dLon = rad(Number(b.longitude) - Number(a.longitude));
  const lat1 = rad(Number(a.latitude));
  const lat2 = rad(Number(b.latitude));
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function lineupImpact(team, matchId) {
  return availability
    .filter((event) =>
      event.team === team &&
      Number(matchId) >= Number(event.start_match_id) &&
      Number(matchId) <= Number(event.end_match_id) &&
      event.availability === 'unavailable')
    .reduce((total, event) => total + Number(event.estimated_xg_impact || 0), 0);
}

function motivationImpact(team) {
  const standing = standingByTeam.get(team);
  if (!standing) return 0;
  const points = Number(standing.points);
  if (points === 0) return 0.05;
  if (points === 1) return 0.02;
  return 0;
}

const previousMatch = new Map();
const rows = [];
for (const match of schedule.filter((item) => item.stage === 'Group stage')) {
  const venue = venueByName.get(match.venue);
  const kickoff = kickoffDate(match);
  const homePrevious = previousMatch.get(match.home);
  const awayPrevious = previousMatch.get(match.away);
  const homeRestHours = homePrevious ? (kickoff - homePrevious.kickoff) / 3600000 : '';
  const awayRestHours = awayPrevious ? (kickoff - awayPrevious.kickoff) / 3600000 : '';
  const homeTravelKm = homePrevious ? haversineKm(homePrevious.venue, venue) : 0;
  const awayTravelKm = awayPrevious ? haversineKm(awayPrevious.venue, venue) : 0;
  const referee = assignedReferee(match);
  const restDifferenceDays = homeRestHours === '' || awayRestHours === ''
    ? 0
    : (homeRestHours - awayRestHours) / 24;
  const travelDifferenceThousands = (awayTravelKm - homeTravelKm) / 1000;
  const homeRestAdjustment = Math.max(
    -0.08,
    Math.min(0.08, restDifferenceDays * 0.015 + travelDifferenceThousands * 0.015),
  );
  const awayRestAdjustment = -homeRestAdjustment;

  rows.push({
    match_id: match.match_id,
    referee: referee?.referee_name ?? '',
    referee_cards_per_match: referee?.yellow_cards_per_match ?? '',
    referee_penalties_per_match: referee?.penalties_per_match ?? '',
    temperature_c: '',
    humidity_pct: '',
    wind_kph: '',
    precipitation_mm: '',
    weather_forecast_time: '',
    weather_status: match.status === 'scheduled' ? 'pending_forecast_refresh' : 'historical_weather_pending',
    altitude_m: venue?.altitude_m ?? '',
    roof_type: venue?.roof_type ?? '',
    home_rest_hours: homeRestHours === '' ? '' : homeRestHours.toFixed(1),
    away_rest_hours: awayRestHours === '' ? '' : awayRestHours.toFixed(1),
    home_travel_km: homeTravelKm.toFixed(0),
    away_travel_km: awayTravelKm.toFixed(0),
    home_lineup_adjustment: lineupImpact(match.home, match.match_id).toFixed(3),
    away_lineup_adjustment: lineupImpact(match.away, match.match_id).toFixed(3),
    home_motivation_adjustment: motivationImpact(match.home).toFixed(3),
    away_motivation_adjustment: motivationImpact(match.away).toFixed(3),
    home_rest_adjustment: homeRestAdjustment.toFixed(3),
    away_rest_adjustment: awayRestAdjustment.toFixed(3),
    weather_goal_adjustment: '',
    referee_goal_adjustment: '',
    motivation_basis: 'standings_snapshot_2026-06-18_dynamic_refresh_required',
    notes: referee ? 'referee assignment imported; historical style metrics pending' : 'referee assignment pending',
    source_urls: referee?.appointment_source_url ?? '',
    verified_at: new Date().toISOString(),
  });

  previousMatch.set(match.home, { kickoff, venue });
  previousMatch.set(match.away, { kickoff, venue });
}

writeCsv(path.join(root, 'data', 'match_context_2026.csv'), Object.keys(rows[0]), rows);
console.log(`Built context rows for ${rows.length} group-stage matches.`);
