#!/usr/bin/env node
import { Command } from 'commander';
import { checkNodeVersion } from './checkNodeVersion';
import { authCommand } from './commands/auth';
import { cacheCommand } from './commands/cache';
import { configCommand } from './commands/config';
import { deleteCommand } from './commands/delete';
import { evalCommand } from './commands/eval';
import { exportCommand } from './commands/export';
import { feedbackCommand } from './commands/feedback';
import { generateDatasetCommand } from './commands/generate/dataset';
import { importCommand } from './commands/import';
import { initCommand } from './commands/init';
import { listCommand } from './commands/list';
import { shareCommand } from './commands/share';
import { showCommand } from './commands/show';
import { versionCommand } from './commands/version';
import { viewCommand } from './commands/view';
import { runDbMigrations } from './migrate';
import { generateRedteamCommand } from './redteam/commands/generate';
import { initCommand as redteamInitCommand } from './redteam/commands/init';
import { pluginsCommand as redteamPluginsCommand } from './redteam/commands/plugins';
import { checkForUpdates } from './updates';

async function main() {
  await checkForUpdates();
  await runDbMigrations();

  const program = new Command();

  cacheCommand(program);
  configCommand(program);
  deleteCommand(program);
  evalCommand(program);
  exportCommand(program);
  feedbackCommand(program);
  importCommand(program);
  initCommand(program);
  listCommand(program);
  shareCommand(program);
  showCommand(program);
  versionCommand(program);
  viewCommand(program);
  authCommand(program);

  const generateCommand = program.command('generate').description('Generate synthetic data');
  generateDatasetCommand(generateCommand);
  generateRedteamCommand(generateCommand, 'redteam');

  const redteamBaseCommand = program.command('redteam').description('Red team LLM applications');
  redteamInitCommand(redteamBaseCommand);
  redteamPluginsCommand(redteamBaseCommand);
  generateRedteamCommand(redteamBaseCommand, 'generate');

  if (!process.argv.slice(2).length) {
    program.outputHelp();
    process.exit(0);
  }
  program.parse(process.argv);
}

if (require.main === module) {
  checkNodeVersion();
  main();
}
