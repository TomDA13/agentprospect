const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const config = require('../config/config.json');

class SheetsExporter {
  constructor() {
    this.sheets = null;
    this.spreadsheetId = null;
    this.sheetName = config.google_sheets.sheet_name;
  }

  /**
   * Initialize Google Sheets API client using service account credentials.
   */
  async init() {
    const credentialsPath = path.resolve(__dirname, '..', config.google_sheets.credentials_path);

    if (!fs.existsSync(credentialsPath)) {
      console.warn('[Sheets] Google credentials file not found. Sheets export disabled.');
      console.warn(`[Sheets] Expected at: ${credentialsPath}`);
      return false;
    }

    this.spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || config.google_sheets.spreadsheet_id;

    if (!this.spreadsheetId) {
      console.warn('[Sheets] No spreadsheet ID configured. Sheets export disabled.');
      return false;
    }

    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const authClient = await auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: authClient });

      // Verify access by getting spreadsheet info
      await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      console.log('[Sheets] Connected to Google Sheets successfully');
      return true;
    } catch (err) {
      console.error(`[Sheets] Failed to initialize: ${err.message}`);
      return false;
    }
  }

  /**
   * Ensure the target sheet exists with proper headers.
   */
  async ensureSheet() {
    if (!this.sheets) return false;

    try {
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const sheetExists = spreadsheet.data.sheets.some(
        (s) => s.properties.title === this.sheetName
      );

      if (!sheetExists) {
        // Create the sheet
        await this.sheets.spreadsheets.batchUpdate({
          spreadsheetId: this.spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: {
                    title: this.sheetName,
                  },
                },
              },
            ],
          },
        });
        console.log(`[Sheets] Created new sheet: "${this.sheetName}"`);
      }

      // Check if headers exist
      const headerRange = `'${this.sheetName}'!A1:K1`;
      const headerResponse = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: headerRange,
      });

      if (!headerResponse.data.values || headerResponse.data.values.length === 0) {
        // Write headers
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: headerRange,
          valueInputOption: 'RAW',
          requestBody: {
            values: [
              [
                'Date',
                'Username',
                'Résumé besoin',
                'Subreddit',
                'Score Urgence',
                'Score Qualification',
                'Raison',
                'URL',
                'Email',
                'Upvotes',
                'Statut',
              ],
            ],
          },
        });
        console.log('[Sheets] Headers written');

        // Format headers (bold + freeze)
        const sheetId = await this.getSheetId();
        if (sheetId !== null) {
          await this.sheets.spreadsheets.batchUpdate({
            spreadsheetId: this.spreadsheetId,
            requestBody: {
              requests: [
                {
                  repeatCell: {
                    range: {
                      sheetId,
                      startRowIndex: 0,
                      endRowIndex: 1,
                    },
                    cell: {
                      userEnteredFormat: {
                        textFormat: { bold: true },
                        backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
                      },
                    },
                    fields: 'userEnteredFormat(textFormat,backgroundColor)',
                  },
                },
                {
                  updateSheetProperties: {
                    properties: {
                      sheetId,
                      gridProperties: { frozenRowCount: 1 },
                    },
                    fields: 'gridProperties.frozenRowCount',
                  },
                },
              ],
            },
          });
        }
      }

      return true;
    } catch (err) {
      console.error(`[Sheets] Error ensuring sheet: ${err.message}`);
      return false;
    }
  }

  /**
   * Get the numeric sheet ID for the target sheet.
   */
  async getSheetId() {
    try {
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const sheet = spreadsheet.data.sheets.find(
        (s) => s.properties.title === this.sheetName
      );

      return sheet ? sheet.properties.sheetId : null;
    } catch {
      return null;
    }
  }

  /**
   * Get existing usernames in the sheet to avoid duplicates.
   */
  async getExistingEntries() {
    if (!this.sheets) return new Set();

    try {
      const range = `'${this.sheetName}'!B:H`;
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range,
      });

      const entries = new Set();
      if (response.data.values) {
        for (const row of response.data.values) {
          // Use username + URL as unique key
          if (row[0] && row[6]) {
            entries.add(`${row[0]}::${row[6]}`);
          }
        }
      }

      return entries;
    } catch (err) {
      console.warn(`[Sheets] Error reading existing entries: ${err.message}`);
      return new Set();
    }
  }

  /**
   * Export prospects to Google Sheets, avoiding duplicates.
   */
  async exportProspects(prospects) {
    if (!this.sheets) {
      console.log('[Sheets] Export skipped (not initialized)');
      return { added: 0, skipped: 0 };
    }

    await this.ensureSheet();

    const existing = await this.getExistingEntries();
    let added = 0;
    let skipped = 0;

    const newRows = [];

    for (const prospect of prospects) {
      const key = `${prospect.username}::${prospect.url}`;

      if (existing.has(key)) {
        skipped++;
        continue;
      }

      newRows.push([
        prospect.date,
        prospect.username,
        prospect.summary,
        `r/${prospect.subreddit}`,
        prospect.urgency_score,
        prospect.qualification_score,
        prospect.reason,
        prospect.url,
        prospect.email,
        prospect.score,
        prospect.status,
      ]);

      added++;
    }

    if (newRows.length > 0) {
      // Sort by qualification score descending before inserting
      newRows.sort((a, b) => b[5] - a[5] || b[4] - a[4]);

      try {
        await this.sheets.spreadsheets.values.append({
          spreadsheetId: this.spreadsheetId,
          range: `'${this.sheetName}'!A:K`,
          valueInputOption: 'RAW',
          insertDataOption: 'INSERT_ROWS',
          requestBody: {
            values: newRows,
          },
        });

        console.log(`[Sheets] Exported ${added} new prospects (${skipped} duplicates skipped)`);
      } catch (err) {
        console.error(`[Sheets] Export error: ${err.message}`);
      }
    } else {
      console.log(`[Sheets] No new prospects to export (${skipped} duplicates)`);
    }

    return { added, skipped };
  }
}

module.exports = SheetsExporter;
