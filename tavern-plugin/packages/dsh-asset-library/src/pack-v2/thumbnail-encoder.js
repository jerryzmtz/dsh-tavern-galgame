import sharp from 'sharp'

// Keep this process free of the host's independently versioned sharp/libvips DLLs.
const size = Number(process.argv[2]) || 256
try {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  const bytes = await sharp(Buffer.concat(chunks), {limitInputPixels:32 * 1024 ** 2, sequentialRead:true})
    .rotate().toColourspace('srgb').resize({width:size,height:size,fit:'inside',withoutEnlargement:true})
    .webp({quality:80,effort:3}).toBuffer()
  process.stdout.write(bytes)
} catch (error) {
  process.stderr.write(error.message)
  process.exitCode = 1
}
