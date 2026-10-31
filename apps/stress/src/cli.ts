import { digest } from '@stress/digest';
import { main } from '@stress/run';

const argv = process.argv.slice(2);
if (argv[0] === 'digest') {
  console.log(digest(argv[1] ?? '.'));
} else {
  process.exitCode = await main(argv);
}
