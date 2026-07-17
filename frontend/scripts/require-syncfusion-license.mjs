const license = process.env.SYNCFUSION_LICENSE;

if (typeof license !== 'string' || license.trim().length === 0) {
  console.error('SYNCFUSION_LICENSE is not configured.');
  process.exit(1);
}
