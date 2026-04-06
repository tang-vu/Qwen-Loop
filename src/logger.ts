import winston from 'winston';
import chalk from 'chalk';

/**
 * Logger singleton class that provides structured, colorized logging
 * with support for console and file outputs.
 */
class Logger {
  private static instance: Logger;
  private logger: winston.Logger;

  private constructor(level: string = 'info') {
    this.logger = winston.createLogger({
      level,
      format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.printf(({ timestamp, level, message, agent, task }) => {
          const agentTag = agent ? chalk.cyan(`[${agent}]`) : '';
          const taskTag = task ? chalk.yellow(`[${task}]`) : '';
          
          const levels: Record<string, string> = {
            error: chalk.red('ERROR'),
            warn: chalk.yellow('WARN'),
            info: chalk.blue('INFO'),
            debug: chalk.gray('DEBUG')
          };

          return `${chalk.gray(timestamp)} ${levels[level]} ${agentTag}${taskTag} ${message}`;
        })
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        }),
        new winston.transports.File({ 
          filename: 'logs/qwen-loop.log',
          maxsize: 5242880, // 5MB
          maxFiles: 5
        })
      ]
    });
  }

  /**
   * Get or create the Logger singleton instance
   * @param level - Optional log level to set on creation
   * @returns The Logger instance
   */
  static getInstance(level?: string): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger(level);
    }
    return Logger.instance;
  }

  /**
   * Log an informational message
   * @param message - The message to log
   * @param metadata - Optional metadata (agent or task identifiers)
   */
  info(message: string, metadata?: { agent?: string; task?: string }) {
    this.logger.info(message, metadata);
  }

  /**
   * Log a warning message
   * @param message - The message to log
   * @param metadata - Optional metadata (agent or task identifiers)
   */
  warn(message: string, metadata?: { agent?: string; task?: string }) {
    this.logger.warn(message, metadata);
  }

  /**
   * Log an error message
   * @param message - The message to log
   * @param metadata - Optional metadata (agent or task identifiers)
   */
  error(message: string, metadata?: { agent?: string; task?: string }) {
    this.logger.error(message, metadata);
  }

  /**
   * Log a debug message
   * @param message - The message to log
   * @param metadata - Optional metadata (agent or task identifiers)
   */
  debug(message: string, metadata?: { agent?: string; task?: string }) {
    this.logger.debug(message, metadata);
  }
}

export const logger = Logger.getInstance();

/**
 * Set the global log level
 * @param level - The logging level to use
 */
export function setLogLevel(level: 'error' | 'warn' | 'info' | 'debug') {
  Logger.getInstance(level);
}
