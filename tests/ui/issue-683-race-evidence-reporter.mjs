import {
  ISSUE_683_PR03C_TITLE,
  ISSUE_683_SMOKE_EVIDENCE_ATTACHMENT,
  issue683RaceObservations
} from './issue-683-race-evidence.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const EMPTY_TEXT = '',
  JSON_INDENT = 2,
  UTF8_ENCODING = 'utf8',
  readAttachmentBody = (attachment) => {
    let body = EMPTY_TEXT;

    if (attachment.body) {
      body = Buffer.from(attachment.body).toString(UTF8_ENCODING);
    } else if (attachment.path) {
      body = readFileSync(attachment.path, UTF8_ENCODING);
    }

    return body;
  },
  parseRaceEvidence = (attachment) => {
    const outcome = {
      parseError: null,
      raceObservations: []
    };

    if (!attachment) {
      outcome.parseError = `Missing ${ISSUE_683_SMOKE_EVIDENCE_ATTACHMENT} attachment.`;
      return outcome;
    }

    try {
      const body = readAttachmentBody(attachment);

      if (!body) {
        throw new Error('Attachment has neither an inline body nor a readable path.');
      }
      outcome.raceObservations = issue683RaceObservations(JSON.parse(body));
    } catch (error) {
      let parseError = String(error);

      if (error instanceof Error) {
        parseError = error.message;
      }
      outcome.parseError = parseError;
    }

    return outcome;
  },
  buildPr03cRecord = (testCase, result) => {
    const attachment = result.attachments.find(
        (candidate) => candidate.name === ISSUE_683_SMOKE_EVIDENCE_ATTACHMENT
      ),
      parsed = parseRaceEvidence(attachment);

    return {
      attachmentFound: Boolean(attachment),
      parseError: parsed.parseError,
      raceObservations: parsed.raceObservations,
      retry: result.retry,
      status: result.status,
      title: testCase.title
    };
  },
  writeEvidence = (outputPath, records, retries) => {
    const serialized = `${JSON.stringify({ records, retries }, null, JSON_INDENT)}\n`;

    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, serialized, UTF8_ENCODING);
  };

export default class Issue683RaceEvidenceReporter {
  records = [];

  retries = [];

  onTestEnd(testCase, result) {
    this.retries.push(result.retry);
    if (testCase.title === ISSUE_683_PR03C_TITLE) {
      this.records.push(buildPr03cRecord(testCase, result));
    }
  }

  onEnd() {
    const outputPath = process.env.AIP_ISSUE_683_EVIDENCE_FILE?.trim();

    if (!outputPath) {
      throw new Error('AIP_ISSUE_683_EVIDENCE_FILE is required by the Issue #683 evidence reporter.');
    }
    writeEvidence(outputPath, this.records, this.retries);
  }
}
