import { runSmoke } from './smoke-test.js';

async function main() {
  try {
    await runSmoke();
    // eslint-disable-next-line no-console
    console.log('✅ smoke tests passed');
    process.exit(0);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('❌ smoke tests failed:', err?.stack || err?.message || err);
    
    if (err?.cause?.code === 'ECONNREFUSED' || err?.message?.includes('fetch failed')) {
      // eslint-disable-next-line no-console
      console.error('\n⚠️  Make sure the server is running first:');
      // eslint-disable-next-line no-console
      console.error('   npm run dev');
      // eslint-disable-next-line no-console
      console.error('   (or set BASE_URL env var to test against a different server)\n');
    }
    
    process.exit(1);
  }
}

main();
