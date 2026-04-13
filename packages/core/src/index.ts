export { runCli } from './cli/run';
export { Daemon, SessionManager, TaskQueue } from './daemon';

// 启动 CLI
import { runCli } from './cli';
runCli();
