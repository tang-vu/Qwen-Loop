import { Task, TaskPriority, TaskStatus } from '../types.js';
import { logger } from '../logger.js';
import { v4 as uuidv4 } from 'uuid';
import { readdirSync, readFileSync, statSync, existsSync } from 'fs';
import { join, extname } from 'path';

interface ProjectAnalysis {
  files: FileMeta[];
  fileTypes: Map<string, number>;
  totalLines: number;
  hasTests: boolean;
  hasDocs: boolean;
  hasConfig: boolean;
  complexity: 'low' | 'medium' | 'high';
  largeFiles: FileMeta[];
  filesWithoutTests: string[];
}

interface FileMeta {
  path: string;
  lines: number;
  extension: string;
}

interface TaskTemplate {
  description: string;
  priority: TaskPriority;
  category: string;
  condition?: (analysis: ProjectAnalysis) => boolean;
}

/**
 * Task template pool with 30+ diverse tasks.
 * Generator picks 6-10 random tasks each cycle to avoid repetition.
 */
const TASK_TEMPLATES: TaskTemplate[] = [
  // === TESTS (HIGH priority) ===
  {
    description: 'Add unit tests for core modules (orchestrator, task queue, loop manager). Test edge cases, error handling, and normal flows.',
    priority: TaskPriority.HIGH,
    category: 'tests',
    condition: (a) => !a.hasTests || a.files.filter(f => f.path.includes('test')).length < 3
  },
  {
    description: 'Add integration tests for CLI commands to verify end-to-end workflows work correctly.',
    priority: TaskPriority.HIGH,
    category: 'tests-integration'
  },
  {
    description: 'Add test coverage reporting. Set up coverage thresholds and generate coverage reports.',
    priority: TaskPriority.MEDIUM,
    category: 'tests-coverage'
  },

  // === CODE QUALITY (MEDIUM priority) ===
  {
    description: 'Review and fix TypeScript types. Replace any "any" types with proper interfaces or generics.',
    priority: TaskPriority.MEDIUM,
    category: 'type-safety'
  },
  {
    description: 'Add input validation to all public APIs and CLI command arguments. Validate before processing.',
    priority: TaskPriority.MEDIUM,
    category: 'validation'
  },
  {
    description: 'Improve error handling: add try-catch blocks, proper error messages, and graceful degradation.',
    priority: TaskPriority.MEDIUM,
    category: 'error-handling'
  },
  {
    description: 'Add JSDoc comments to all exported functions and classes. Include @param, @returns, and @throws tags.',
    priority: TaskPriority.MEDIUM,
    category: 'jsdoc'
  },

  // === REFACTORING (based on file size) ===
  {
    description: 'Split large files (>400 lines) into smaller, focused modules. Extract interfaces and reduce coupling.',
    priority: TaskPriority.HIGH,
    category: 'refactor-large-files',
    condition: (a) => a.largeFiles.length > 0
  },
  {
    description: 'Refactor duplicated code into shared utility functions or base classes. Follow DRY principle.',
    priority: TaskPriority.MEDIUM,
    category: 'refactor-dry'
  },
  {
    description: 'Apply dependency injection pattern to reduce coupling between modules and improve testability.',
    priority: TaskPriority.MEDIUM,
    category: 'refactor-di'
  },

  // === DOCUMENTATION ===
  {
    description: 'Create API reference documentation. Document all public methods, parameters, and return types.',
    priority: TaskPriority.MEDIUM,
    category: 'docs-api'
  },
  {
    description: 'Add code examples and usage patterns to README. Show common use cases with copy-paste examples.',
    priority: TaskPriority.LOW,
    category: 'docs-examples'
  },
  {
    description: 'Create a CONTRIBUTING.md guide for developers. Include setup, testing, and code style guidelines.',
    priority: TaskPriority.LOW,
    category: 'docs-contributing',
    condition: (a) => !a.files.some(f => f.path.toLowerCase().includes('contributing'))
  },
  {
    description: 'Add inline code comments explaining complex logic, algorithms, or business rules.',
    priority: TaskPriority.LOW,
    category: 'docs-comments'
  },

  // === PERFORMANCE ===
  {
    description: 'Profile application startup time and optimize slow initialization paths.',
    priority: TaskPriority.LOW,
    category: 'perf-startup'
  },
  {
    description: 'Add caching for expensive computations (file reads, config parsing, project analysis).',
    priority: TaskPriority.MEDIUM,
    category: 'perf-caching'
  },
  {
    description: 'Optimize memory usage: review large object allocations, implement lazy loading where appropriate.',
    priority: TaskPriority.LOW,
    category: 'perf-memory'
  },

  // === SECURITY ===
  {
    description: 'Review for security issues: validate all user inputs, sanitize file paths, prevent command injection.',
    priority: TaskPriority.HIGH,
    category: 'security'
  },
  {
    description: 'Add rate limiting or throttling for API endpoints and CLI operations to prevent abuse.',
    priority: TaskPriority.LOW,
    category: 'security-rate-limit'
  },

  // === CLI USABILITY ===
  {
    description: 'Improve CLI error messages: make them actionable with suggestions on how to fix the problem.',
    priority: TaskPriority.MEDIUM,
    category: 'cli-errors'
  },
  {
    description: 'Add interactive prompts for missing required arguments. Guide users through command usage.',
    priority: TaskPriority.LOW,
    category: 'cli-interactive'
  },
  {
    description: 'Add command aliases and shorthand flags for frequently used commands (e.g., -s for --start).',
    priority: TaskPriority.LOW,
    category: 'cli-aliases'
  },
  {
    description: 'Add progress indicators (spinners, progress bars) for long-running operations.',
    priority: TaskPriority.LOW,
    category: 'cli-progress'
  },

  // === LOGGING & MONITORING ===
  {
    description: 'Review logging levels: ensure debug/info/warn/error are used appropriately. Remove verbose debug logs from production.',
    priority: TaskPriority.MEDIUM,
    category: 'logging-levels'
  },
  {
    description: 'Add structured logging with consistent field names for log analysis and monitoring tools.',
    priority: TaskPriority.LOW,
    category: 'logging-structured'
  },
  {
    description: 'Add health check endpoint or CLI command that reports system status: agent health, task throughput, error rates.',
    priority: TaskPriority.LOW,
    category: 'health-check',
    condition: (a) => !a.files.some(f => f.path.includes('health'))
  },

  // === CONFIG & SETUP ===
  {
    description: 'Add configuration validation with helpful error messages. Validate config on startup and report issues.',
    priority: TaskPriority.MEDIUM,
    category: 'config-validation'
  },
  {
    description: 'Create example configuration files with comments explaining each option.',
    priority: TaskPriority.LOW,
    category: 'config-examples',
    condition: (a) => !a.files.some(f => f.path.includes('example') && f.path.includes('config'))
  },
  {
    description: 'Add environment variable support for sensitive configuration values (API keys, secrets).',
    priority: TaskPriority.MEDIUM,
    category: 'config-env-vars'
  },
];

/**
 * Analyzes the project and generates self-directed tasks.
 * Qwen will autonomously decide what to work on based on project state.
 */
export class SelfTaskGenerator {
  private workingDir: string;
  private completedTasks: Set<string>;
  private taskPool: Task[];
  private lastUsedCategories: string[];

  /**
   * Create a new SelfTaskGenerator
   * @param workingDir - The working directory to analyze
   */
  constructor(workingDir: string) {
    this.workingDir = workingDir;
    this.completedTasks = new Set();
    this.taskPool = [];
    this.lastUsedCategories = [];
  }

  /**
   * Analyze the project directory and gather metadata
   * @returns Object containing project analysis including file count, types, and complexity
   */
  analyzeProject(): ProjectAnalysis {
    const analysis: ProjectAnalysis = {
      files: [],
      fileTypes: new Map(),
      totalLines: 0,
      hasTests: false,
      hasDocs: false,
      hasConfig: false,
      complexity: 'low',
      largeFiles: [],
      filesWithoutTests: []
    };

    this.walkDirectory(this.workingDir, analysis, 0, 3);

    // Determine complexity
    if (analysis.totalLines > 5000) {
      analysis.complexity = 'high';
    } else if (analysis.totalLines > 1000) {
      analysis.complexity = 'medium';
    }

    // Check for tests
    analysis.hasTests = analysis.files.some(f =>
      f.path.includes('test') || f.path.includes('spec') || f.path.includes('__tests__')
    );

    // Check for docs
    analysis.hasDocs = analysis.files.some(f =>
      f.path.toLowerCase().includes('readme') ||
      f.path.toLowerCase().includes('docs') ||
      extname(f.path) === '.md'
    );

    // Check for config
    analysis.hasConfig = analysis.files.some(f =>
      ['package.json', 'tsconfig.json', '.eslintrc', '.prettierrc'].some(name =>
        f.path.includes(name)
      )
    );

    // Find large files (>400 lines) that need refactoring
    analysis.largeFiles = analysis.files.filter(f => f.lines > 400);

    // Find source files without corresponding test files
    for (const file of analysis.files) {
      if (file.extension === '.ts' && !file.path.includes('test') && !file.path.includes('__tests__')) {
        const testPath = file.path.replace('.ts', '.test.ts');
        if (!analysis.files.some(f => f.path === testPath)) {
          analysis.filesWithoutTests.push(file.path);
        }
      }
    }

    return analysis;
  }

  /**
   * Generate diverse self-directed tasks based on project analysis.
   * Picks 6-10 random tasks from 30+ templates to avoid repetition.
   * @param analysis - The project analysis result
   * @returns Array of task descriptions with priorities and categories
   */
  generateTasks(analysis: ProjectAnalysis): Task[] {
    // Filter templates by conditions
    const eligibleTemplates = TASK_TEMPLATES.filter(t =>
      !t.condition || t.condition(analysis)
    );

    // Shuffle for variety
    const shuffled = this.shuffleArray(eligibleTemplates);

    // Pick 6-10 tasks (more for larger projects)
    const count = analysis.totalLines > 3000 ? 10 : analysis.totalLines > 1000 ? 8 : 6;
    const selected = shuffled.slice(0, Math.min(count, shuffled.length));

    // Avoid repeating categories used recently
    const diverseTasks = this.prioritizeDiversity(selected, analysis);

    logger.debug(`Generated ${diverseTasks.length} tasks from ${eligibleTemplates.length} eligible templates`);
    return diverseTasks;
  }

  /**
   * Prioritize tasks from different categories to avoid repetition.
   */
  private prioritizeDiversity(templates: TaskTemplate[], analysis: ProjectAnalysis): Task[] {
    const tasks: Task[] = [];
    const usedCategories = new Set(this.lastUsedCategories);

    // First pass: pick tasks from unused categories
    for (const template of templates) {
      if (!usedCategories.has(template.category)) {
        tasks.push(this.createTask(template, analysis));
        usedCategories.add(template.category);
      }
    }

    // Second pass: fill remaining with less-recent categories
    if (tasks.length < 6) {
      for (const template of templates) {
        if (tasks.length >= 6) break;
        if (!tasks.some(t => t.metadata?.category === template.category)) {
          tasks.push(this.createTask(template, analysis));
        }
      }
    }

    return tasks.slice(0, Math.max(6, tasks.length));
  }

  /**
   * Create a Task object from a template
   */
  private createTask(template: TaskTemplate, analysis: ProjectAnalysis): Task {
    // Customize description based on analysis
    let description = template.description;

    // Add context for refactoring tasks
    if (template.category === 'refactor-large-files' && analysis.largeFiles.length > 0) {
      const largeFileList = analysis.largeFiles.slice(0, 3).map(f => {
        const relativePath = f.path.replace(this.workingDir + '/', '');
        return `${relativePath} (${f.lines} lines)`;
      }).join(', ');
      description += ` Target files: ${largeFileList}`;
    }

    // Add context for test tasks
    if (template.category === 'tests' && analysis.filesWithoutTests.length > 0) {
      const uncoveredCount = analysis.filesWithoutTests.length;
      description = `Add unit tests for ${uncoveredCount} untested source files. Start with core modules.`;
    }

    return {
      id: uuidv4(),
      description,
      priority: template.priority,
      status: TaskStatus.PENDING,
      createdAt: new Date(),
      metadata: { category: template.category, selfGenerated: true }
    };
  }

  /**
   * Get the next task from the pool, cycling through categories
   * Avoids repeating the same task too soon
   * @param analysis - The project analysis result
   * @returns A new Task object, or null if no tasks available
   */
  getNextTask(analysis: ProjectAnalysis): Task | null {
    if (this.taskPool.length === 0) {
      this.taskPool = this.generateTasks(analysis);
    }

    // Pick task avoiding recently used categories
    for (let i = 0; i < this.taskPool.length; i++) {
      const task = this.taskPool[i];
      const category = (task.metadata?.category as string) || '';

      if (!this.lastUsedCategories.includes(category)) {
        this.taskPool.splice(i, 1);
        this.trackCategory(category);
        return task;
      }
    }

    // All tasks are from recent categories, pick anyway
    if (this.taskPool.length > 0) {
      const task = this.taskPool.shift()!;
      this.trackCategory((task.metadata?.category as string) || 'unknown');
      return task;
    }

    // Pool empty, regenerate
    this.taskPool = this.generateTasks(analysis);
    this.completedTasks.clear();

    if (this.taskPool.length > 0) {
      const task = this.taskPool.shift()!;
      this.trackCategory((task.metadata?.category as string) || 'unknown');
      return task;
    }

    logger.warn('No tasks available from SelfTaskGenerator');
    return null;
  }

  /**
   * Track category usage to avoid repetition
   */
  private trackCategory(category: string): void {
    this.lastUsedCategories.push(category);
    // Keep last 5 categories
    if (this.lastUsedCategories.length > 5) {
      this.lastUsedCategories = this.lastUsedCategories.slice(-5);
    }
    this.completedTasks.add(category);
  }

  /**
   * Reset the completed tasks tracking to start fresh
   */
  resetCompleted(): void {
    this.completedTasks.clear();
    this.taskPool = [];
    this.lastUsedCategories = [];
  }

  // Private helpers

  private walkDirectory(dir: string, analysis: ProjectAnalysis, depth: number, maxDepth: number): void {
    if (depth > maxDepth) return;
    if (!existsSync(dir)) return;

    try {
      const entries = readdirSync(dir);

      for (const entry of entries) {
        // Skip node_modules, .git, dist, logs
        if (['node_modules', '.git', 'dist', 'logs'].includes(entry)) continue;

        const fullPath = join(dir, entry);

        try {
          const stats = statSync(fullPath);

          if (stats.isDirectory()) {
            this.walkDirectory(fullPath, analysis, depth + 1, maxDepth);
          } else if (stats.isFile()) {
            try {
              const content = readFileSync(fullPath, 'utf-8');
              const lines = content.split('\n').length;
              const extension = extname(entry);

              const fileMeta: FileMeta = { path: fullPath, lines, extension };
              analysis.files.push(fileMeta);
              analysis.totalLines += lines;

              const count = analysis.fileTypes.get(extension) || 0;
              analysis.fileTypes.set(extension, count + 1);
            } catch (readError) {
              logger.debug(`Could not read file ${fullPath}: ${readError instanceof Error ? readError.message : String(readError)}`);
            }
          }
        } catch (statError) {
          logger.debug(`Could not stat ${fullPath}: ${statError instanceof Error ? statError.message : String(statError)}`);
        }
      }
    } catch (dirError) {
      logger.debug(`Could not read directory ${dir}: ${dirError instanceof Error ? dirError.message : String(dirError)}`);
    }
  }

  private shuffleArray<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}
