import { Command } from 'commander'
import { registerConfigCommand } from './commands/config'
import { registerStartCommand } from './commands/start'

export function runCli(): void {
  const program = new Command()

  program.name('pcr').description('PocketRelay - 手机飞书远程控制 Claude Code').version('0.1.0')

  // 注册子命令
  registerConfigCommand(program)
  registerStartCommand(program)

  // 默认命令：手动处理
  const args = process.argv.slice(2)
  if (args.length === 0) {
    // 没有参数，显示帮助
    program.help()
  } else if (!['start', 'config', 'help'].includes(args[0]) && !args[0].startsWith('-')) {
    // 第一个参数不是子命令也不是选项，注入 start
    process.argv.splice(2, 0, 'start')
    program.parse()
  } else {
    // 正常解析
    program.parse()
  }
}
