// Entry point that dynamically imports and runs the specified benchmark
(async () => {
  const benchmarkFile = process.env.BENCH_FILE || process.argv[2];

  if (!benchmarkFile) {
    console.error('Usage: BENCH_FILE=normalizeDocument pnpm bench:api');
    console.error('Or: node dist/bench.cjs normalizeDocument');
    process.exit(1);
  }

  // Extract filename from path and remove .bench.ts extension
  const filename = benchmarkFile.split('/').pop() || benchmarkFile;
  const cleanName = filename.replace(/\.bench(\.ts)?$/, '');

  // Dynamically import the benchmark file
  try {
    await import(`./${cleanName}.bench`);
  } catch (error) {
    console.error(`Failed to load benchmark: ${cleanName}`);
    console.error('Make sure the file exists in bench/api/');
    console.error(error);
    process.exit(1);
  }
})();
