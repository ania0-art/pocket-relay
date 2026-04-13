import { Command } from 'commander'
import { colors, logSuccess, logError } from '../../logger'
import { loadGlobalConfig, saveGlobalConfig, configPaths } from '../../config'

export function registerConfigCommand(program: Command): void {
  const configCmd = program.command('config').description('管理配置')

  configCmd
    .command('list')
    .description('列出所有配置')
    .action(() => {
      const globalConfig = loadGlobalConfig()
      console.log('')
      console.log(colors.bold('全局配置:'), configPaths.globalConfigPath)
      console.log('')
      if (Object.keys(globalConfig).length === 0) {
        console.log('  (无配置)')
      } else {
        for (const [key, value] of Object.entries(globalConfig)) {
          console.log(`  ${colors.cyan(key)}: ${value}`)
        }
      }
      console.log('')
      console.log(colors.gray('当前目录也可以创建 .env.pcr 文件覆盖全局配置'))
      console.log('')
    })

  configCmd
    .command('set <key> <value>')
    .description('设置配置项')
    .action((key: string, value: string) => {
      const config = loadGlobalConfig()
      ;(config as any)[key] = value
      saveGlobalConfig(config)
      logSuccess(`已设置 ${colors.cyan(key)} = ${colors.yellow(value)}`)
    })

  configCmd
    .command('get <key>')
    .description('查看配置项')
    .action((key: string) => {
      const config = loadGlobalConfig()
      const value = (config as any)[key]
      if (value !== undefined) {
        console.log(`${colors.cyan(key)}: ${value}`)
      } else {
        logError(`配置项 ${colors.cyan(key)} 未设置`)
      }
    })

  configCmd
    .command('unset <key>')
    .description('删除配置项')
    .action((key: string) => {
      const config = loadGlobalConfig()
      delete (config as any)[key]
      saveGlobalConfig(config)
      logSuccess(`已删除 ${colors.cyan(key)}`)
    })
}
