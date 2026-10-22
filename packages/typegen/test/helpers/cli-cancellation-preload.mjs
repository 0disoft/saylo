import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';

// Deterministic process-event delivery at real I/O boundaries, including on Windows where kill()
// force-terminates rather than emulating terminal Ctrl+C. No production test hooks are needed.
const phase = process.env.SAYLO_CANCEL_PHASE;
const signal = process.env.SAYLO_CANCEL_SIGNAL ?? 'SIGINT';
const counts = ['SIGINT', 'SIGTERM'].map(name => process.listenerCount(name));
let delivered = false, renames = 0;
const interrupt = () => { if (!delivered) { delivered = true; process.emit(signal); } };
const managedTemp = file => /\.saylo-(?:import|review|output)-.*\.tmp$/.test(String(file));
const open = fs.open, rename = fs.rename, readFile = fs.readFile, rm = fs.rm, link = fs.link;
fs.open = async (...args) => {
  const handle = await open(...args);
  if ((phase === 'lock' && String(args[0]).endsWith('.lock')) || (phase === 'stage' && managedTemp(args[0]))) interrupt();
  return handle;
};
fs.rename = async (...args) => {
  const result = await rename(...args);
  if (managedTemp(args[0]) && ++renames === Number(process.env.SAYLO_CANCEL_RENAME ?? 1) && phase === 'rename') interrupt();
  return result;
};
fs.link = async (...args) => {
  const result = await link(...args);
  if (managedTemp(args[0]) && phase === 'publish') interrupt();
  return result;
};
fs.readFile = async (...args) => {
  const result = await readFile(...args);
  if (phase === 'workfile' && String(args[0]).endsWith('work.json')) interrupt();
  return result;
};
fs.rm = async (...args) => {
  if (delivered && process.env.SAYLO_CANCEL_REPEAT === 'true') process.emit(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT');
  return rm(...args);
};
syncBuiltinESMExports();
process.once('beforeExit', () => {
  if ((phase !== 'none' && !delivered) || ['SIGINT', 'SIGTERM'].some((name, index) => process.listenerCount(name) !== counts[index])) {
    process.stderr.write('Cancellation phase was not reached or CLI signal listeners leaked.\n');
    process.exitCode = 99;
  }
});
