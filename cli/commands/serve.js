// cli/commands/serve.js
const { Command } = require('commander');
const chalk = require('chalk');

module.exports = new Command('serve')
    .description('启动 InfoMind Web 服务器')
    .option('-p, --port <port>', '服务端口', '3456')
    .action((opts) => {
        process.env.INFOMIND_PORT = opts.port;
        console.log(chalk.cyan(`\n🧠 正在启动 InfoMind 服务器 (端口: ${opts.port})...\n`));
        const { startServer } = require('../../server/index');
        startServer({ port: opts.port }).catch((err) => {
            console.error(chalk.red(`启动失败: ${err.message}`));
            process.exit(1);
        });
    });
