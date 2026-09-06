import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  ISSUE_683_PR03C_TITLE,
  ISSUE_683_SMOKE_EVIDENCE_ATTACHMENT,
  issue683RaceObservations
} from './issue-683-race-evidence.mjs';

export default class Issue683RaceEvidenceReporter {
  records = [];

  async onTestEnd(test, result) {
    if (test.title !== ISSUE_683_PR03C_TITLE) {
      return;
    }

    const attachment = result.attachments.find(
      (candidate) => candidate.name === ISSUE_683_SMOKE_EVIDENCE_ATTACHMENT
    );
    const record = {
      title: test.title,
      status: result.status,
      retry: result.retry,
      attachmentFound: Boolean(attachment),
      parseError: null,
      raceObservations: []
    };

    if (!attachment) {
      record.parseError = `Missing ${ISSUE_683_SMOKE_EVIDENCE_ATTACHMENT} attachment.`;
      this.records.push(record);
      return;
    }

    try {
      const body = attachment.body
        ? Buffer.from(attachment.body).toString('utf8')
        : attachment.path
          ? await readFile(attachment.path, 'utf8')
          : '';
      if (!body) {
        throw new Error('Attachment has neither an inline body nor a readable path.');
      }

      const smokeEvidence = JSON.parse(body);
      record.raceObservations = issue683RaceObservations(smokeEvidence);
    } catch (error) {
      record.parseError = error instanceof Error ? error.message : String(error);
    }

    this.records.push(record);
  }

  async onEnd() {
    const outputPath = process.env.AIP_ISSUE_683_EVIDENCE_FILE?.trim();
    if (!outputPath) {
      throw new Error('AIP_ISSUE_683_EVIDENCE_FILE is required by the Issue #683 evidence reporter.');
    }

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(
      outputPath,
      `${JSON.stringify({ records: this.records }, null, 2)}\n`,
      'utf8'
    );
  }
}
