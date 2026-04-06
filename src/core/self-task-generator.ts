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
}

interface FileMeta {
  path: string;
  lines: number;
  extension: string;
}

/**
 * Analyzes the project and generates self-directed tasks.
 * Qwen will autonomously decide what to work on based on project state.
 */
export class SelfTaskGenerator {
  private workingDir: string;
  private completedTasks: string[] = [];
  private taskPool: TaskDescription[] = [];

  /**
   * Create a new SelfTaskGenerator
   * @param workingDir - The working directory to analyze
   */
  constructor(workingDir: string) {
    this.workingDir = workingDir;
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
      complexity: 'low'
    };

    this.walkDirectory(this.workingDir, analysis, 0, 3); // Max depth 3

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

    return analysis;
  }

  /**
   * Generate self-directed tasks based on project analysis
   * @param analysis - The project analysis result
   * @returns Array of task descriptions with priorities and categories
   */
  generateTasks(analysis: ProjectAnalysis): TaskDescription[] {
    const tasks: TaskDescription[] = [];

    // Always suggest tests if missing
    if (!analysis.hasTests) {
      tasks.push({
        description: 'Add unit tests for the core modules. Create test files for the orchestrator, task queue, and loop manager. Use a simple test runner.',
        priority: TaskPriority.HIGH,
        category: 'tests'
      });
    }

    // Improve docs if sparse
    if (!analysis.hasDocs || analysis.files.filter(f => extname(f.path) === '.md').length < 2) {
      tasks.push({
        description: 'Improve project documentation. Add a CHANGELOG.md, update README with more examples, and create an ARCHITECTURE.md explaining the codebase structure.',
        priority: TaskPriority.MEDIUM,
        category: 'docs'
      });
    }

    // Code quality improvements based on file count
    if (analysis.files.length > 5) {
      tasks.push({
        description: 'Review the codebase for code quality improvements: add proper error handling, improve type safety, add JSDoc comments to public methods, and fix any inconsistencies.',
        priority: TaskPriority.MEDIUM,
        category: 'quality'
      });
    }

    // Add more tasks for larger projects
    if (analysis.totalLines > 500) {
      tasks.push({
        description: 'Add a health check endpoint or CLI command that reports system status: agent health, task throughput, error rates, and resource usage.',
        priority: TaskPriority.LOW,
        category: 'feature'
      });
    }

    // Generic improvement tasks that always apply
    tasks.push({
      description: 'Review and optimize the logging system. Ensure log messages are informative and not too verbose. Add structured logging for better analysis.',
      priority: TaskPriority.LOW,
      category: 'quality'
    });

    tasks.push({
      description: 'Review the CLI interface for usability improvements. Add helpful error messages, interactive prompts, and a better help output.',
      priority: TaskPriority.LOW,
      category: 'feature'
    });

    // Shuffle for variety
    return this.shuffleArray(tasks);
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

    // Pick the highest priority task that hasn't been completed recently
    const priorityOrder = [
      TaskPriority.CRITICAL,
      TaskPriority.HIGH,
      TaskPriority.MEDIUM,
      TaskPriority.LOW
    ];

    for (const priority of priorityOrder) {
      const task = this.taskPool.find(t =>
        t.priority === priority && !this.completedTasks.includes(t.category + t.description.slice(0, 30))
      );

      if (task) {
        // Remove from pool
        this.taskPool = this.taskPool.filter(t => t !== task);

        // Mark as completed (by category signature)
        const signature = task.category + task.description.slice(0, 30);
        this.completedTasks.push(signature);

        // Keep only last 20 completed to prevent memory growth
        if (this.completedTasks.length > 20) {
          this.completedTasks = this.completedTasks.slice(-20);
        }

        return {
          id: uuidv4(),
          description: task.description,
          priority: task.priority,
          status: TaskStatus.PENDING,
          createdAt: new Date(),
          metadata: { category: task.category, selfGenerated: true }
        };
      }
    }

    // All tasks completed, regenerate pool
    this.taskPool = this.generateTasks(analysis);
    this.completedTasks = []; // Clear completed to avoid infinite loop
    
    // Get from new pool (iterative, not recursive)
    if (this.taskPool.length > 0) {
      const task = this.taskPool.shift()!;
      const signature = task.category + task.description.slice(0, 30);
      this.completedTasks.push(signature);
      
      return {
        id: uuidv4(),
        description: task.description,
        priority: task.priority,
        status: TaskStatus.PENDING,
        createdAt: new Date(),
        metadata: { category: task.category, selfGenerated: true }
      };
    }
    
    // Should never reach here unless generateTasks returns empty
    logger.warn('No tasks available from SelfTaskGenerator');
    return null;
  }

  /**
   * Reset the completed tasks tracking to start fresh
   */
  resetCompleted(): void {
    this.completedTasks = [];
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
              // Skip files we can't read - log in debug mode
              logger.debug(`Could not read file ${fullPath}: ${readError instanceof Error ? readError.message : String(readError)}`);
            }
          }
        } catch (statError) {
          // Skip files/directories we can't stat - log in debug mode
          logger.debug(`Could not stat ${fullPath}: ${statError instanceof Error ? statError.message : String(statError)}`);
        }
      }
    } catch (dirError) {
      // Skip directories we can't read - log in debug mode  
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

interface TaskDescription {
  description: string;
  priority: TaskPriority;
  category: string;
}
