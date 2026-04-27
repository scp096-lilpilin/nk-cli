/**
 * @file Tiny structured logger writing to stdout and a daily log file.
 *
 * The logger intentionally has zero hard runtime dependencies for the
 * file-write path so it remains usable inside `process.on('exit')`
 * handlers where async I/O is unsafe. Terminal output is colourised
 * via {@link https://github.com/chalk/chalk chalk}; if chalk fails to
 * load we transparently fall back to plain ASCII.
 */

import fs from 'node:fs';
import path from 'node:path';

import { config } from '../config/index.js';

/**
 * Supported log levels. The numeric ordering controls filtering.
 *
 * @type {Readonly<Record<'debug' | 'info' | 'warn' | 'error', number>>}
 */
const LEVELS = Object.freeze({ debug: 10, info: 20, warn: 30, error: 40 });

/** @type {keyof typeof LEVELS} */
const ACTIVE_LEVEL =
  /** @type {keyof typeof LEVELS} */ (process.env.NK_LOG_LEVEL ?? 'info');

/**
 * Lazily-resolved chalk instance. Loaded asynchronously the first time
 * a record is emitted; until then we render plain text.
 *
 * @type {import('chalk').ChalkInstance | null}
 */
let chalk = null;

/* eslint-disable promise/catch-or-return */
import('chalk')
  .then((mod) => {
    chalk = mod.default;
  })
  .catch(() => {
    /* chalk is optional; plain text fallback is fine */
  });
/* eslint-enable promise/catch-or-return */

/**
 * Whether terminal output should include ANSI colour codes. Defaults to
 * on when stdout is a TTY and `NK_LOG_COLOR` has not been disabled.
 *
 * @type {boolean}
 */
const COLOR_ENABLED = (() => {
  const raw = (process.env.NK_LOG_COLOR ?? '').toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no' || raw === 'off') return false;
  if (raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on') return true;
  return Boolean(process.stdout.isTTY);
})();

/**
 * Lazily-created append stream for the active log file.
 *
 * @type {fs.WriteStream | null}
 */
let logStream = null;

/**
 * Build (and cache) the file write stream that mirrors all log lines.
 *
 * @returns {fs.WriteStream} Append-mode stream pointing at today's log file.
 */
function getLogStream() {
  if (logStream) return logStream;
  fs.mkdirSync(config.paths.logs, { recursive: true });
  const now = new Date();
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const logFile = path.join(config.paths.logs, `nk-cli-${date}.log`);
  logStream = fs.createWriteStream(logFile, { flags: 'a' });
  return logStream;
}

/**
 * Zero-pad a small integer to two digits.
 *
 * @param {number} value Value in 0–99 range.
 * @returns {string} Two-character zero-padded string.
 */
function pad2(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * Zero-pad an integer to three digits.
 *
 * @param {number} value Value in 0–999 range.
 * @returns {string} Three-character zero-padded string.
 */
function pad3(value) {
  if (value < 10) return `00${value}`;
  if (value < 100) return `0${value}`;
  return `${value}`;
}

/**
 * Format the current wall-clock time in the local timezone as
 * `YYYY-MM-DD HH:mm:ss.SSS`. Chosen over `toISOString()` because the
 * user runs the scraper interactively and wants timestamps that match
 * their local clock.
 *
 * @returns {string} Local timestamp.
 */
function formatTimestamp() {
  const now = new Date();
  return (
    `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ` +
    `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}.` +
    `${pad3(now.getMilliseconds())}`
  );
}

/**
 * Apply a chalk style to a string, returning the original unchanged
 * when colour is disabled or chalk is not yet loaded.
 *
 * @param {(value: string) => string} style Chalk style function.
 * @param {string} value Raw text to colourise.
 * @returns {string} Possibly-coloured text.
 */
function paint(style, value) {
  if (!COLOR_ENABLED || !chalk) return value;
  try {
    return style(value);
  } catch {
    return value;
  }
}

/**
 * Render the level tag (`[INFO]`, `[ERROR]`, …) with an appropriate colour.
 *
 * @param {keyof typeof LEVELS} level Severity of the record.
 * @returns {string} Painted level tag including brackets.
 */
function paintLevel(level) {
  const tag = `[${level.toUpperCase()}]`;
  if (!COLOR_ENABLED || !chalk) return tag;
  switch (level) {
    case 'debug':
      return chalk.gray(tag);
    case 'info':
      return chalk.cyan(tag);
    case 'warn':
      return chalk.yellow(tag);
    case 'error':
      return chalk.red.bold(tag);
    default:
      return tag;
  }
}

/**
 * Build the metadata suffix for a log record (`{...json...}`), or an
 * empty string when no metadata was supplied.
 *
 * @param {Record<string, unknown> | undefined} meta Optional metadata.
 * @returns {{ painted: string, plain: string }} Painted and plain renderings.
 */
function renderMeta(meta) {
  if (!meta || Object.keys(meta).length === 0) {
    return { painted: '', plain: '' };
  }
  const json = JSON.stringify(meta);
  return {
    painted: ` ${paint((s) => chalk.gray(s), json)}`,
    plain: ` ${json}`,
  };
}

/**
 * Format a single log record for terminal output (with colour) and for
 * the on-disk log file (plain text).
 *
 * @param {keyof typeof LEVELS} level Severity of the record.
 * @param {string} message Human-readable message body.
 * @param {Record<string, unknown>} [meta] Optional structured metadata.
 * @returns {{ tty: string, file: string }} Newline-terminated lines.
 */
function formatLine(level, message, meta) {
  const timestamp = formatTimestamp();
  const { painted, plain } = renderMeta(meta);
  const file = `${timestamp} [${level.toUpperCase()}] ${message}${plain}\n`;
  const tty =
    `${paint((s) => chalk.dim(s), timestamp)} ` +
    `${paintLevel(level)} ${message}${painted}\n`;
  return { tty, file };
}

/**
 * Emit a log record if its level passes the active threshold.
 *
 * @param {keyof typeof LEVELS} level Severity of the record.
 * @param {string} message Human-readable message body.
 * @param {Record<string, unknown>} [meta] Optional structured metadata.
 * @returns {void}
 */
function log(level, message, meta) {
  if (LEVELS[level] < LEVELS[ACTIVE_LEVEL]) return;
  const { tty, file } = formatLine(level, message, meta);
  const target = level === 'error' ? process.stderr : process.stdout;
  target.write(tty);
  try {
    getLogStream().write(file);
  } catch {
    // Logging must never throw; swallow filesystem errors.
  }
}

/**
 * Logger facade with one method per supported severity.
 *
 * @type {Readonly<Record<keyof typeof LEVELS, (msg: string, meta?: Record<string, unknown>) => void>>}
 */
export const logger = Object.freeze({
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),
});
