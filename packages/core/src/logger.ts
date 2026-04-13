// 简单的彩色输出
const colors = {
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`
}

export function logInfo(msg: string) {
  console.log(colors.gray('[info]'), msg)
}

export function logSuccess(msg: string) {
  console.log(colors.green('✓'), msg)
}

export function logError(msg: string) {
  console.error(colors.red('✗'), msg)
}

export function logWarn(msg: string) {
  console.warn(colors.yellow('⚠'), msg)
}

export { colors }
