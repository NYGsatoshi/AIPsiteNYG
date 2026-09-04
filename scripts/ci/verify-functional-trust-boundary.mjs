import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export function verifyFunctionalLicensedWorkflow(source) {
  const errors = [];
  const workflow = String(source);

  if (/^\s*pull_request_target\s*:/m.test(workflow)) {
    errors.push('licensed workflow must never use pull_request_target');
  }
  if (/^\s*pull_request\s*:/m.test(workflow)) {
    errors.push('licensed workflow must not execute on pull_request events');
  }
  if (!/^\s*environment:\s*syncfusion-licensed-build\s*$/m.test(workflow)) {
    errors.push('licensed job must remain behind the syncfusion-licensed-build protected environment');
  }
  if (!/^\s*SYNCFUSION_LICENSE:\s*\$\{\{\s*secrets\.SYNCFUSION_LICENSE\s*\}\}\s*$/m.test(workflow)) {
    errors.push('licensed job must source SYNCFUSION_LICENSE only from the protected secret');
  }
  if (!/^\s*ref:\s*\$\{\{\s*github\.sha\s*\}\}\s*$/m.test(workflow)) {
    errors.push('licensed checkout must pin the reviewed github.sha');
  }
  if (!/^\s*persist-credentials:\s*false\s*$/m.test(workflow)) {
    errors.push('licensed checkout must keep persist-credentials disabled');
  }

  return errors;
}

export async function verifyFunctionalLicensedWorkflowFile(filePath) {
  const source = await readFile(filePath, 'utf8');
  const errors = verifyFunctionalLicensedWorkflow(source);
  if (errors.length > 0) {
    throw new Error(`Functional licensed workflow trust-boundary verification failed:\n- ${errors.join('\n- ')}`);
  }
  return { filePath, checks: 6 };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const filePath = process.argv[2] ?? '.github/workflows/licensed-real-backend-acceptance.yml';
  try {
    const result = await verifyFunctionalLicensedWorkflowFile(filePath);
    console.log(`Functional licensed workflow trust boundary verified (${result.checks} checks): ${result.filePath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
