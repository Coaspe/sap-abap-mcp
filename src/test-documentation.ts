import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import {
  AlignmentType,
  Document,
  HeadingLevel,
  ImageRun,
  LineRuleType,
  Packer,
  PageOrientation,
  Paragraph,
  TextRun,
  convertInchesToTwip
} from "docx"
import { AppError } from "./errors.js"

export interface TestDocumentationInput {
  scenarios: Array<{
    scenarioId: number
    scenarioName: string
    scenarioDescription: string
    screenshots: Array<{ filePath: string; description: string }>
  }>
  reportTitle?: string
  testDate?: string
}

function imageType(filePath: string): "jpg" | "png" | "gif" | "bmp" {
  const extension = extname(filePath).toLowerCase()
  if (extension === ".jpg" || extension === ".jpeg") return "jpg"
  if (extension === ".png") return "png"
  if (extension === ".gif") return "gif"
  if (extension === ".bmp") return "bmp"
  throw new AppError(
    "SCREENSHOT_FORMAT_UNSUPPORTED",
    `Screenshot must be PNG, JPEG, GIF, or BMP: ${filePath}`
  )
}

function localPath(value: string): string {
  return value.startsWith("file://") ? fileURLToPath(value) : value
}

function currentDate(): string {
  const now = new Date()
  return [
    String(now.getDate()).padStart(2, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    now.getFullYear()
  ].join("-")
}

function safeFileName(title: string): string {
  const normalized = title.trim().replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "")
  return `${normalized || "test-documentation"}.docx`
}

export async function createTestDocumentation(input: TestDocumentationInput) {
  if (input.scenarios.length === 0) {
    throw new AppError("TEST_SCENARIOS_REQUIRED", "At least one test scenario is required")
  }
  const reportTitle = input.reportTitle?.trim() || "Test Documentation Report"
  const testDate = input.testDate || currentDate()
  const children: Paragraph[] = [
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun(reportTitle)]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      children: [new TextRun({ text: `Test date: ${testDate}`, bold: true, color: "555555" })]
    })
  ]
  const failures: Array<{ filePath: string; error: string }> = []

  for (const scenario of input.scenarios) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        text: `Scenario ${scenario.scenarioId}: ${scenario.scenarioName}`
      }),
      new Paragraph({
        children: [new TextRun(scenario.scenarioDescription)]
      })
    )
    if (scenario.screenshots.length === 0) {
      children.push(new Paragraph({
        children: [new TextRun({ text: "No screenshots supplied.", italics: true, color: "666666" })]
      }))
      continue
    }

    for (let index = 0; index < scenario.screenshots.length; index += 1) {
      const screenshot = scenario.screenshots[index]!
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        text: `${index + 1}. ${screenshot.description}`
      }))
      try {
        const path = localPath(screenshot.filePath)
        const data = await readFile(path)
        children.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { after: 320 },
          children: [new ImageRun({
            data,
            type: imageType(path),
            transformation: { width: 600, height: 400 },
            altText: {
              name: `Scenario ${scenario.scenarioId} screenshot ${index + 1}`,
              title: screenshot.description,
              description: screenshot.description
            }
          })]
        }))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        failures.push({ filePath: screenshot.filePath, error: message })
        children.push(new Paragraph({
          children: [new TextRun({
            text: `Screenshot could not be loaded: ${screenshot.filePath} (${message})`,
            color: "9B1C1C",
            italics: true
          })]
        }))
      }
    }
  }

  const document = new Document({
    creator: "sap-abap-mcp",
    title: reportTitle,
    subject: "Test documentation",
    description: "Test scenarios and their supporting screenshots",
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22, color: "000000" },
          paragraph: { spacing: { after: 120, line: 264, lineRule: LineRuleType.AUTO } }
        },
        title: {
          run: { font: "Calibri", size: 48, bold: true, color: "1F4D78" },
          paragraph: { spacing: { before: 0, after: 160 } }
        },
        heading1: {
          run: { font: "Calibri", size: 32, bold: true, color: "2E74B5" },
          paragraph: { spacing: { before: 320, after: 160 } }
        },
        heading2: {
          run: { font: "Calibri", size: 26, bold: true, color: "2E74B5" },
          paragraph: { spacing: { before: 240, after: 120 } }
        }
      }
    },
    sections: [{
      properties: {
        page: {
          size: { orientation: PageOrientation.PORTRAIT },
          margin: {
            top: convertInchesToTwip(1),
            right: convertInchesToTwip(1),
            bottom: convertInchesToTwip(1),
            left: convertInchesToTwip(1),
            header: convertInchesToTwip(0.492),
            footer: convertInchesToTwip(0.492)
          }
        }
      },
      children
    }]
  })
  const outputDirectory = await mkdtemp(join(tmpdir(), "sap-abap-mcp-test-doc-"))
  const outputPath = join(outputDirectory, safeFileName(reportTitle))
  await writeFile(outputPath, await Packer.toBuffer(document))
  return {
    outputPath,
    reportTitle,
    testDate,
    scenarioCount: input.scenarios.length,
    screenshotCount: input.scenarios.reduce((sum, item) => sum + item.screenshots.length, 0),
    embeddedScreenshots: input.scenarios.reduce((sum, item) => sum + item.screenshots.length, 0) - failures.length,
    failures
  }
}
