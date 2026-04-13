import { config as dotenvConfig } from 'dotenv'
import { join } from 'node:path'
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'

const GLOBAL_CONFIG_DIR = join(homedir(), '.pocket-relay')
const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, 'config.json')
const LOCAL_CONFIG_NAME = '.env.pcr'

export interface Config {
  larkAppId?: string
  larkAppSecret?: string
  claudeBin?: string
  claudeCwd?: string
  taskTimeoutMs?: number
}

function getConfigDir(): string {
  if (!existsSync(GLOBAL_CONFIG_DIR)) {
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true })
  }
  return GLOBAL_CONFIG_DIR
}

export function loadGlobalConfig(): Config {
  if (!existsSync(GLOBAL_CONFIG_PATH)) {
    return {}
  }
  try {
    return JSON.parse(readFileSync(GLOBAL_CONFIG_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

export function saveGlobalConfig(config: Config): void {
  getConfigDir()
  writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify(config, null, 2))
}

export function loadLocalConfig(cwd: string): Config {
  const localPath = join(cwd, LOCAL_CONFIG_NAME)
  if (!existsSync(localPath)) {
    return {}
  }
  dotenvConfig({ path: localPath })
  return {
    larkAppId: process.env.LARK_APP_ID,
    larkAppSecret: process.env.LARK_APP_SECRET,
    claudeBin: process.env.CLAUDE_BIN,
    claudeCwd: process.env.CLAUDE_CWD,
    taskTimeoutMs: process.env.TASK_TIMEOUT_MS
      ? parseInt(process.env.TASK_TIMEOUT_MS, 10)
      : undefined
  }
}

export function mergeConfig(
  globalConfig: Config,
  localConfig: Config,
  cliOptions: Partial<Config>
): Config {
  return {
    larkAppId: cliOptions.larkAppId ?? localConfig.larkAppId ?? globalConfig.larkAppId,
    larkAppSecret:
      cliOptions.larkAppSecret ?? localConfig.larkAppSecret ?? globalConfig.larkAppSecret,
    claudeBin: cliOptions.claudeBin ?? localConfig.claudeBin ?? globalConfig.claudeBin ?? 'claude',
    claudeCwd: cliOptions.claudeCwd ?? localConfig.claudeCwd ?? globalConfig.claudeCwd,
    taskTimeoutMs:
      cliOptions.taskTimeoutMs ?? localConfig.taskTimeoutMs ?? globalConfig.taskTimeoutMs ?? 600000
  }
}

export const configPaths = {
  globalConfigDir: GLOBAL_CONFIG_DIR,
  globalConfigPath: GLOBAL_CONFIG_PATH,
  localConfigName: LOCAL_CONFIG_NAME
}
