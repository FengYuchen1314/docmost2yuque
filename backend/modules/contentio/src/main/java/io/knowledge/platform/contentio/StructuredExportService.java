package io.knowledge.platform.contentio;

import java.awt.AlphaComposite;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Font;
import java.awt.Graphics2D;
import java.awt.Polygon;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import javax.imageio.ImageIO;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.graphics.image.LosslessFactory;
import org.apache.poi.ss.usermodel.FillPatternType;
import org.apache.poi.ss.usermodel.FontUnderline;
import org.apache.poi.ss.usermodel.HorizontalAlignment;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.ss.util.CellRangeAddressList;
import org.apache.poi.ss.util.WorkbookUtil;
import org.apache.poi.xssf.usermodel.DefaultIndexedColorMap;
import org.apache.poi.xssf.usermodel.XSSFCellStyle;
import org.apache.poi.xssf.usermodel.XSSFColor;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;

@Service
final class StructuredExportService {

    private static final Pattern NUMBER = Pattern.compile("-?(?:0|[1-9]\\d*)(?:\\.\\d+)?");
    private static final Pattern FIELD_REFERENCE = Pattern.compile("\\{([^}]+)\\}");
    private static final int BOARD_LIMIT = 8_000;

    TransferArtifact generate(
            ContentTransferRepository.PageSnapshot page,
            String format,
            boolean watermarkEnabled,
            String watermarkText,
            String watermarkPosition,
            double watermarkOpacity) {
        try {
            return switch (page.contentType()) {
                case "WHITEBOARD" -> whiteboard(
                        page, format, watermarkEnabled, watermarkText,
                        watermarkPosition, watermarkOpacity);
                case "SPREADSHEET" -> spreadsheet(
                        page, format, watermarkEnabled, watermarkText,
                        watermarkPosition, watermarkOpacity);
                case "DATABASE" -> database(
                        page, format, watermarkEnabled, watermarkText);
                default -> throw new IllegalArgumentException(
                        "Structured export content type is invalid");
            };
        } catch (IOException exception) {
            throw new IllegalStateException("Structured export generation failed", exception);
        }
    }

    private TransferArtifact whiteboard(
            ContentTransferRepository.PageSnapshot page,
            String format,
            boolean marked,
            String mark,
            String position,
            double opacity) throws IOException {
        if ("SVG".equals(format)) {
            String svg = boardSvg(page.content(), marked, mark, position, opacity);
            return new TransferArtifact(file(page.title(), "svg"), "image/svg+xml; charset=utf-8",
                    svg.getBytes(StandardCharsets.UTF_8));
        }
        BufferedImage image = boardImage(page.content(), marked, mark, position, opacity);
        if ("PDF".equals(format)) {
            return imagePdf(page.title(), List.of(image));
        }
        if (!"PNG".equals(format) && !"JPG".equals(format)) {
            throw new IllegalArgumentException("Whiteboard export format is invalid");
        }
        String extension = "PNG".equals(format) ? "png" : "jpg";
        try (var out = new ByteArrayOutputStream()) {
            ImageIO.write(image, extension, out);
            return new TransferArtifact(
                    file(page.title(), extension),
                    "PNG".equals(format) ? "image/png" : "image/jpeg",
                    out.toByteArray());
        }
    }

    private TransferArtifact spreadsheet(
            ContentTransferRepository.PageSnapshot page,
            String format,
            boolean marked,
            String mark,
            String position,
            double opacity) throws IOException {
        if ("XLSX".equals(format)) return workbook(page, marked, mark);
        if ("PDF".equals(format)) {
            return imagePdf(page.title(), workbookImages(
                    page.content(), marked, mark, position, opacity));
        }
        throw new IllegalArgumentException("Spreadsheet export format is invalid");
    }

    private TransferArtifact database(
            ContentTransferRepository.PageSnapshot page,
            String format,
            boolean marked,
            String mark) throws IOException {
        if ("XLSX".equals(format)) return databaseWorkbook(page, marked, mark);
        if ("CSV".equals(format)) return databaseCsv(page, marked, mark);
        throw new IllegalArgumentException("Database export format is invalid");
    }

    private BufferedImage boardImage(
            JsonNode content,
            boolean marked,
            String mark,
            String position,
            double opacity) {
        SceneBounds bounds = sceneBounds(content.path("elements"));
        BufferedImage image = new BufferedImage(bounds.width(), bounds.height(), BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = image.createGraphics();
        graphics.setColor(new Color(248, 249, 248));
        graphics.fillRect(0, 0, bounds.width(), bounds.height());
        graphics.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        graphics.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        graphics.setStroke(new BasicStroke(2f));
        for (JsonNode element : content.path("elements")) drawBoardElement(graphics, element, bounds);
        drawWatermark(graphics, bounds.width(), bounds.height(), marked, mark, position, opacity);
        graphics.dispose();
        return image;
    }

    private void drawBoardElement(Graphics2D graphics, JsonNode element, SceneBounds bounds) {
        int x = integer(element.path("x"), 0) - bounds.minX() + 64;
        int y = integer(element.path("y"), 0) - bounds.minY() + 64;
        int width = Math.max(24, integer(element.path("width"), 160));
        int height = Math.max(24, integer(element.path("height"), 80));
        String kind = text(element.path("kind"), "RECT").toUpperCase(Locale.ROOT);
        Color fill = color(text(element.path("color"), "#ffffff"), Color.WHITE);
        graphics.setColor(fill);
        if ("ELLIPSE".equals(kind)) graphics.fillOval(x, y, width, height);
        else if (!"TEXT".equals(kind) && !"ARROW".equals(kind)) graphics.fillRoundRect(x, y, width, height, 14, 14);
        graphics.setColor(new Color(76, 91, 82));
        if ("ELLIPSE".equals(kind)) graphics.drawOval(x, y, width, height);
        else if ("ARROW".equals(kind)) drawArrow(graphics, x, y + height / 2, x + width, y + height / 2);
        else if (!"TEXT".equals(kind)) graphics.drawRoundRect(x, y, width, height, 14, 14);
        if (!"ARROW".equals(kind)) {
            graphics.setFont(new Font(Font.SANS_SERIF, "STICKY".equals(kind) ? Font.BOLD : Font.PLAIN, 20));
            drawLines(graphics, text(element.path("text"), ""), x + 12, y + 30, width - 24, height - 20);
        }
    }

    private static void drawArrow(Graphics2D graphics, int x1, int y1, int x2, int y2) {
        graphics.drawLine(x1, y1, x2, y2);
        int size = 10;
        Polygon head = new Polygon(
                new int[] {x2, x2 - size, x2 - size},
                new int[] {y2, y2 - size / 2, y2 + size / 2}, 3);
        graphics.fillPolygon(head);
    }

    private static void drawLines(
            Graphics2D graphics, String value, int x, int y, int width, int height) {
        int lineHeight = graphics.getFontMetrics().getHeight();
        int maximum = Math.max(1, width / Math.max(8, graphics.getFontMetrics().charWidth('汉')));
        int currentY = y;
        for (String source : value.split("\\R", -1)) {
            String line = source;
            do {
                String visible = line.substring(0, Math.min(line.length(), maximum));
                graphics.drawString(visible, x, currentY);
                currentY += lineHeight;
                line = line.substring(visible.length());
            } while (!line.isEmpty() && currentY <= y + height);
            if (currentY > y + height) break;
        }
    }

    private String boardSvg(
            JsonNode content,
            boolean marked,
            String mark,
            String position,
            double opacity) {
        SceneBounds bounds = sceneBounds(content.path("elements"));
        StringBuilder svg = new StringBuilder("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"")
                .append(bounds.width()).append("\" height=\"").append(bounds.height())
                .append("\" viewBox=\"0 0 ").append(bounds.width()).append(' ').append(bounds.height())
                .append("\"><rect width=\"100%\" height=\"100%\" fill=\"#f8f9f8\"/>");
        for (JsonNode element : content.path("elements")) {
            int x = integer(element.path("x"), 0) - bounds.minX() + 64;
            int y = integer(element.path("y"), 0) - bounds.minY() + 64;
            int width = Math.max(24, integer(element.path("width"), 160));
            int height = Math.max(24, integer(element.path("height"), 80));
            String kind = text(element.path("kind"), "RECT").toUpperCase(Locale.ROOT);
            String fill = hexColor(text(element.path("color"), "#ffffff"));
            if ("ELLIPSE".equals(kind)) svg.append("<ellipse cx=\"").append(x + width / 2)
                    .append("\" cy=\"").append(y + height / 2).append("\" rx=\"")
                    .append(width / 2).append("\" ry=\"").append(height / 2)
                    .append("\" fill=\"").append(fill).append("\" stroke=\"#4c5b52\"/>");
            else if ("ARROW".equals(kind)) svg.append("<line x1=\"").append(x).append("\" y1=\"")
                    .append(y + height / 2).append("\" x2=\"").append(x + width).append("\" y2=\"")
                    .append(y + height / 2).append("\" stroke=\"#4c5b52\" stroke-width=\"2\"/>");
            else if (!"TEXT".equals(kind)) svg.append("<rect x=\"").append(x).append("\" y=\"")
                    .append(y).append("\" width=\"").append(width).append("\" height=\"")
                    .append(height).append("\" rx=\"12\" fill=\"").append(fill)
                    .append("\" stroke=\"#4c5b52\"/>");
            if (!"ARROW".equals(kind)) svg.append("<text x=\"").append(x + 12).append("\" y=\"")
                    .append(y + 30).append("\" font-family=\"sans-serif\" font-size=\"20\" fill=\"#26322b\">")
                    .append(escape(text(element.path("text"), "").replace('\n', ' '))).append("</text>");
        }
        appendSvgWatermark(svg, bounds.width(), bounds.height(), marked, mark, position, opacity);
        return svg.append("</svg>").toString();
    }

    private TransferArtifact workbook(
            ContentTransferRepository.PageSnapshot page,
            boolean marked,
            String mark) throws IOException {
        try (var workbook = new XSSFWorkbook(); var out = new ByteArrayOutputStream()) {
            JsonNode sheets = page.content().path("sheets");
            int sheetIndex = 0;
            for (JsonNode source : sheets) {
                String requestedName = text(source.path("name"), "Sheet " + (sheetIndex + 1));
                String name = uniqueSheetName(workbook, requestedName, sheetIndex++);
                var target = workbook.createSheet(name);
                JsonNode rows = source.path("rows");
                JsonNode sourceStyles = source.path("styles");
                Set<String> protectedCells = stringSet(source.path("protectedCells"));
                Set<Integer> hiddenRows = integerSet(source.path("hiddenRows"));
                Set<Integer> hiddenColumns = integerSet(source.path("hiddenColumns"));
                Map<String, XSSFCellStyle> styles = new HashMap<>();
                int maximumColumns = 0;
                int rowIndex = 0;
                for (JsonNode sourceRow : rows) {
                    var row = target.createRow(rowIndex);
                    if (hiddenRows.contains(rowIndex)) row.setZeroHeight(true);
                    int columnIndex = 0;
                    for (JsonNode sourceCell : sourceRow) {
                        var cell = row.createCell(columnIndex);
                        String cellKey = rowIndex + ":" + columnIndex;
                        JsonNode cellStyle = sourceStyles.path(cellKey);
                        setSpreadsheetCell(cell, cellValue(sourceCell), cellStyle);
                        applyStyle(
                                workbook,
                                cell,
                                cellStyle,
                                protectedCells.contains(cellKey),
                                styles);
                        columnIndex++;
                    }
                    maximumColumns = Math.max(maximumColumns, columnIndex);
                    rowIndex++;
                }
                int frozenRows = Math.max(0, integer(source.path("frozenRows"), 0));
                int frozenColumns = Math.max(0, integer(source.path("frozenColumns"), 0));
                if (frozenRows > 0 || frozenColumns > 0) {
                    target.createFreezePane(frozenColumns, frozenRows);
                }
                if (!text(source.path("filter"), "").isBlank() && rowIndex > 0 && maximumColumns > 0) {
                    target.setAutoFilter(new CellRangeAddress(0, rowIndex - 1, 0, maximumColumns - 1));
                }
                for (int column = 0; column < Math.min(maximumColumns, 40); column++) {
                    target.autoSizeColumn(column);
                    if (hiddenColumns.contains(column)) target.setColumnHidden(column, true);
                }
                applyDropdowns(target, source.path("dropdowns"));
                if (!protectedCells.isEmpty()) target.protectSheet("");
                if (marked) target.getFooter().setCenter(mark);
            }
            if (workbook.getNumberOfSheets() == 0) workbook.createSheet("Sheet 1");
            workbook.setForceFormulaRecalculation(true);
            workbook.write(out);
            return new TransferArtifact(file(page.title(), "xlsx"),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    out.toByteArray());
        }
    }

    private TransferArtifact databaseWorkbook(
            ContentTransferRepository.PageSnapshot page,
            boolean marked,
            String mark) throws IOException {
        try (var workbook = new XSSFWorkbook(); var out = new ByteArrayOutputStream()) {
            var sheet = workbook.createSheet("Records");
            JsonNode fields = page.content().path("fields");
            JsonNode rows = page.content().path("rows");
            var header = sheet.createRow(0);
            int column = 0;
            for (JsonNode field : fields) {
                var cell = header.createCell(column++);
                cell.setCellValue(text(field.path("name"), "Column " + column));
                var style = workbook.createCellStyle();
                var font = workbook.createFont();
                font.setBold(true);
                style.setFont(font);
                cell.setCellStyle(style);
            }
            int rowIndex = 1;
            for (JsonNode sourceRow : rows) {
                var targetRow = sheet.createRow(rowIndex++);
                column = 0;
                for (JsonNode field : fields) {
                    setDatabaseCell(
                            targetRow.createCell(column++),
                            databaseValue(page.content(), sourceRow, field));
                }
            }
            sheet.createFreezePane(0, 1);
            if (rowIndex > 1 && column > 0) sheet.setAutoFilter(new CellRangeAddress(0, rowIndex - 1, 0, column - 1));
            for (int index = 0; index < Math.min(column, 40); index++) sheet.autoSizeColumn(index);
            if (marked) sheet.getFooter().setCenter(mark);
            workbook.write(out);
            return new TransferArtifact(file(page.title(), "xlsx"),
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    out.toByteArray());
        }
    }

    private TransferArtifact databaseCsv(
            ContentTransferRepository.PageSnapshot page,
            boolean marked,
            String mark) {
        JsonNode fields = page.content().path("fields");
        StringBuilder csv = new StringBuilder("\ufeff");
        List<String> headers = new ArrayList<>();
        for (JsonNode field : fields) headers.add(text(field.path("name"), "Column"));
        if (marked) headers.add("水印");
        csv.append(headers.stream().map(StructuredExportService::csvEscape)
                .reduce((left, right) -> left + "," + right).orElse("")).append("\r\n");
        for (JsonNode row : page.content().path("rows")) {
            List<String> values = new ArrayList<>();
            for (JsonNode field : fields) {
                values.add(csvCell(databaseValue(page.content(), row, field)));
            }
            if (marked) values.add(csvEscape(mark));
            csv.append(String.join(",", values)).append("\r\n");
        }
        return new TransferArtifact(file(page.title(), "csv"), "text/csv; charset=utf-8",
                csv.toString().getBytes(StandardCharsets.UTF_8));
    }

    private List<BufferedImage> workbookImages(
            JsonNode content,
            boolean marked,
            String mark,
            String position,
            double opacity) {
        List<BufferedImage> images = new ArrayList<>();
        int sheetNumber = 0;
        for (JsonNode sheet : content.path("sheets")) {
            JsonNode rows = sheet.path("rows");
            int rowCount = Math.max(1, rows.size());
            int columnCount = 1;
            for (JsonNode row : rows) columnCount = Math.max(columnCount, row.size());
            for (int rowStart = 0; rowStart < rowCount; rowStart += 35) {
                for (int columnStart = 0; columnStart < columnCount; columnStart += 10) {
                    images.add(tableImage(
                            text(sheet.path("name"), "Sheet " + (++sheetNumber)), rows,
                            rowStart, columnStart, marked, mark, position, opacity));
                }
            }
        }
        if (images.isEmpty()) images.add(tableImage("Sheet 1", content.path("missing"),
                0, 0, marked, mark, position, opacity));
        return images;
    }

    private BufferedImage tableImage(
            String title,
            JsonNode rows,
            int rowStart,
            int columnStart,
            boolean marked,
            String mark,
            String position,
            double opacity) {
        int columns = 10;
        int visibleRows = Math.max(1, Math.min(35, rows.size() - rowStart));
        int columnWidth = 140;
        int rowHeight = 28;
        int width = columns * columnWidth + 80;
        int height = 80 + visibleRows * rowHeight;
        BufferedImage image = new BufferedImage(width, height, BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = image.createGraphics();
        graphics.setColor(Color.WHITE);
        graphics.fillRect(0, 0, width, height);
        graphics.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);
        graphics.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 20));
        graphics.setColor(new Color(38, 50, 43));
        graphics.drawString(title + " · " + columnName(columnStart) + " / row " + (rowStart + 1), 18, 30);
        graphics.setFont(new Font(Font.SANS_SERIF, Font.PLAIN, 13));
        for (int rowIndex = 0; rowIndex < visibleRows; rowIndex++) {
            JsonNode row = rows.path(rowStart + rowIndex);
            for (int columnIndex = 0; columnIndex < columns; columnIndex++) {
                int x = 18 + columnIndex * columnWidth;
                int y = 48 + rowIndex * rowHeight;
                graphics.setColor(rowIndex == 0 ? new Color(232, 240, 235) : Color.WHITE);
                graphics.fillRect(x, y, columnWidth, rowHeight);
                graphics.setColor(new Color(190, 201, 194));
                graphics.drawRect(x, y, columnWidth, rowHeight);
                graphics.setColor(new Color(38, 50, 43));
                String value = cellValue(row.path(columnStart + columnIndex));
                graphics.drawString(value.substring(0, Math.min(value.length(), 18)), x + 5, y + 19);
            }
        }
        drawWatermark(graphics, width, height, marked, mark, position, opacity);
        graphics.dispose();
        return image;
    }

    private TransferArtifact imagePdf(String title, List<BufferedImage> images) throws IOException {
        try (var document = new PDDocument(); var out = new ByteArrayOutputStream()) {
            for (BufferedImage image : images) {
                PDPage page = new PDPage(new PDRectangle(PDRectangle.A4.getHeight(), PDRectangle.A4.getWidth()));
                document.addPage(page);
                var embedded = LosslessFactory.createFromImage(document, image);
                float padding = 24;
                float scale = Math.min(
                        (page.getMediaBox().getWidth() - padding * 2) / image.getWidth(),
                        (page.getMediaBox().getHeight() - padding * 2) / image.getHeight());
                float width = image.getWidth() * scale;
                float height = image.getHeight() * scale;
                try (var stream = new PDPageContentStream(document, page)) {
                    stream.drawImage(embedded,
                            (page.getMediaBox().getWidth() - width) / 2,
                            (page.getMediaBox().getHeight() - height) / 2,
                            width, height);
                }
            }
            document.save(out);
            return new TransferArtifact(file(title, "pdf"), "application/pdf", out.toByteArray());
        }
    }

    private static void setSpreadsheetCell(
            org.apache.poi.ss.usermodel.Cell cell, String value, JsonNode style) {
        if (value.startsWith("=") && value.length() > 1) {
            try {
                cell.setCellFormula(value.substring(1));
                return;
            } catch (IllegalArgumentException ignored) {
                // Keep unsupported formulas visible instead of dropping their source.
            }
        }
        if ("DATE".equals(text(style.path("numberFormat"), "").toUpperCase(Locale.ROOT))) {
            try {
                cell.setCellValue(LocalDate.parse(value));
                return;
            } catch (RuntimeException ignored) {
                // Invalid date text remains visible as text.
            }
        }
        if (NUMBER.matcher(value).matches() && !(value.length() > 1 && value.startsWith("0"))) {
            try {
                cell.setCellValue(Double.parseDouble(value));
                return;
            } catch (NumberFormatException ignored) {
                // Extremely large numeric text remains text.
            }
        }
        cell.setCellValue(value);
    }

    private static void setDatabaseCell(org.apache.poi.ss.usermodel.Cell cell, Object value) {
        if (value instanceof Boolean booleanValue) cell.setCellValue(booleanValue);
        else if (value instanceof Number numberValue) cell.setCellValue(numberValue.doubleValue());
        else cell.setCellValue(value == null ? "" : String.valueOf(value));
    }

    private static void applyStyle(
            XSSFWorkbook workbook,
            org.apache.poi.ss.usermodel.Cell cell,
            JsonNode source,
            boolean locked,
            Map<String, XSSFCellStyle> cache) {
        String key = (source.isObject() ? source.toString() : "{}") + "|locked=" + locked;
        XSSFCellStyle style = cache.computeIfAbsent(key, ignored -> {
            XSSFCellStyle created = workbook.createCellStyle();
            boolean bold = source.path("bold").asBoolean(false);
            boolean italic = source.path("italic").asBoolean(false);
            boolean underline = source.path("underline").asBoolean(false);
            String foreground = text(source.path("color"), "");
            if (bold || italic || underline || foreground.matches("#[0-9a-fA-F]{6}")) {
                var font = workbook.createFont();
                font.setBold(bold);
                font.setItalic(italic);
                if (underline) font.setUnderline(FontUnderline.SINGLE.getByteValue());
                if (foreground.matches("#[0-9a-fA-F]{6}")) {
                    font.setColor(new XSSFColor(color(foreground, Color.BLACK),
                            new DefaultIndexedColorMap()));
                }
                created.setFont(font);
            }
            String background = text(source.path("background"), "");
            if (background.matches("#[0-9a-fA-F]{6}")) {
                created.setFillForegroundColor(new XSSFColor(color(background, Color.WHITE),
                        new DefaultIndexedColorMap()));
                created.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            }
            String alignment = text(source.path("align"), "LEFT").toUpperCase(Locale.ROOT);
            if (Set.of("LEFT", "CENTER", "RIGHT").contains(alignment)) {
                created.setAlignment(HorizontalAlignment.valueOf(alignment));
            }
            String numberFormat = text(source.path("numberFormat"), "GENERAL").toUpperCase(Locale.ROOT);
            String pattern = switch (numberFormat) {
                case "NUMBER" -> "#,##0.##########";
                case "CURRENCY" -> "¥#,##0.00";
                case "PERCENT" -> "0.00%";
                case "DATE" -> "yyyy-mm-dd";
                default -> null;
            };
            if (pattern != null) created.setDataFormat(workbook.createDataFormat().getFormat(pattern));
            created.setLocked(locked);
            return created;
        });
        cell.setCellStyle(style);
    }

    private static void applyDropdowns(
            org.apache.poi.xssf.usermodel.XSSFSheet sheet,
            JsonNode dropdowns) {
        if (!dropdowns.isObject()) return;
        var helper = sheet.getDataValidationHelper();
        for (var property : dropdowns.properties()) {
            String[] coordinates = property.getKey().split(":", -1);
            if (coordinates.length != 2 || !property.getValue().isArray()) continue;
            try {
                int row = Integer.parseInt(coordinates[0]);
                int column = Integer.parseInt(coordinates[1]);
                if (row < 0 || column < 0) continue;
                List<String> options = new ArrayList<>();
                for (JsonNode option : property.getValue()) {
                    if (option.isString() && !option.stringValue().isBlank()) {
                        options.add(option.stringValue().substring(
                                0, Math.min(option.stringValue().length(), 120)));
                    }
                }
                if (options.isEmpty() || String.join(",", options).length() > 250) continue;
                var constraint = helper.createExplicitListConstraint(options.toArray(String[]::new));
                var validation = helper.createValidation(
                        constraint, new CellRangeAddressList(row, row, column, column));
                validation.setShowErrorBox(true);
                validation.setSuppressDropDownArrow(true);
                sheet.addValidationData(validation);
            } catch (NumberFormatException ignored) {
                // Invalid client coordinates are ignored without invalidating the workbook export.
            }
        }
    }

    private static void drawWatermark(
            Graphics2D graphics,
            int width,
            int height,
            boolean enabled,
            String text,
            String position,
            double opacity) {
        if (!enabled) return;
        graphics.setComposite(AlphaComposite.getInstance(
                AlphaComposite.SRC_OVER, (float) Math.max(.05, Math.min(.4, opacity))));
        graphics.setColor(new Color(45, 86, 60));
        graphics.setFont(new Font(Font.SANS_SERIF, Font.BOLD, 17));
        if ("TILED".equals(position)) {
            for (int y = 120; y < height; y += 220) {
                for (int x = 80; x < width; x += 420) graphics.drawString(text, x, y);
            }
        } else if ("CENTER".equals(position)) {
            graphics.drawString(text, Math.max(20, width / 2 - 140), height / 2);
        } else {
            graphics.drawString(text, Math.max(20, width - 420), height - 24);
        }
    }

    private static void appendSvgWatermark(
            StringBuilder svg,
            int width,
            int height,
            boolean enabled,
            String text,
            String position,
            double opacity) {
        if (!enabled) return;
        String escaped = escape(text);
        if ("TILED".equals(position)) {
            for (int y = 120; y < height; y += 220) {
                for (int x = 80; x < width; x += 420) appendSvgMark(svg, escaped, x, y, opacity);
            }
        } else if ("CENTER".equals(position)) appendSvgMark(svg, escaped, width / 2, height / 2, opacity);
        else appendSvgMark(svg, escaped, Math.max(20, width - 420), height - 24, opacity);
    }

    private static void appendSvgMark(
            StringBuilder svg, String text, int x, int y, double opacity) {
        svg.append("<text x=\"").append(x).append("\" y=\"").append(y)
                .append("\" font-family=\"sans-serif\" font-size=\"17\" font-weight=\"700\" fill=\"#2d563c\" opacity=\"")
                .append(Math.max(.05, Math.min(.4, opacity))).append("\">")
                .append(text).append("</text>");
    }

    private static SceneBounds sceneBounds(JsonNode elements) {
        int minX = 0;
        int minY = 0;
        int maxX = 1_152;
        int maxY = 592;
        for (JsonNode element : elements) {
            int x = clamp(integer(element.path("x"), 0), -BOARD_LIMIT, BOARD_LIMIT);
            int y = clamp(integer(element.path("y"), 0), -BOARD_LIMIT, BOARD_LIMIT);
            int width = clamp(integer(element.path("width"), 160), 24, BOARD_LIMIT);
            int height = clamp(integer(element.path("height"), 80), 24, BOARD_LIMIT);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + width);
            maxY = Math.max(maxY, y + height);
        }
        return new SceneBounds(minX, minY,
                clamp(maxX - minX + 128, 640, BOARD_LIMIT),
                clamp(maxY - minY + 128, 480, BOARD_LIMIT));
    }

    private static int integer(JsonNode value, int fallback) {
        return value.isNumber() ? value.asInt() : fallback;
    }

    private static String text(JsonNode value, String fallback) {
        return value.isString() ? value.stringValue() : fallback;
    }

    private static Set<String> stringSet(JsonNode value) {
        Set<String> values = new HashSet<>();
        if (value.isArray()) {
            for (JsonNode item : value) {
                if (item.isString()) values.add(item.stringValue());
            }
        }
        return values;
    }

    private static Set<Integer> integerSet(JsonNode value) {
        Set<Integer> values = new HashSet<>();
        if (value.isArray()) {
            for (JsonNode item : value) {
                if (item.isInt() && item.asInt() >= 0) values.add(item.asInt());
            }
        }
        return values;
    }

    private static String cellValue(JsonNode value) {
        if (value.isMissingNode() || value.isNull()) return "";
        return value.isString() ? value.stringValue() : jsonValue(value);
    }

    private static String jsonValue(JsonNode value) {
        if (value.isMissingNode() || value.isNull()) return "";
        if (value.isArray()) {
            List<String> values = new ArrayList<>();
            for (JsonNode item : value) values.add(cellValue(item));
            return String.join(", ", values);
        }
        return value.isString() ? value.stringValue() : value.toString();
    }

    private static String csvCell(Object value) {
        String raw = databaseText(value);
        if (value instanceof String && !raw.isEmpty() && "=+-@".indexOf(raw.charAt(0)) >= 0) raw = "'" + raw;
        return csvEscape(raw);
    }

    private static Object databaseValue(JsonNode content, JsonNode row, JsonNode field) {
        return databaseValue(content.path("fields"), row, field, new HashSet<>());
    }

    private static Object databaseValue(
            JsonNode fields, JsonNode row, JsonNode field, Set<String> seen) {
        String id = text(field.path("id"), "");
        String type = text(field.path("type"), "TEXT");
        if (!"FORMULA".equals(type) && !"ROLLUP".equals(type)) {
            JsonNode value = row.path("values").path(id);
            if (value.isBoolean()) return value.asBoolean();
            if (value.isNumber()) return value.asDouble();
            return jsonValue(value);
        }
        if (!seen.add(id)) return "#CYCLE!";
        try {
            var matcher = FIELD_REFERENCE.matcher(text(field.path("formula"), ""));
            StringBuilder expression = new StringBuilder();
            while (matcher.find()) {
                JsonNode source = fieldByName(fields, matcher.group(1));
                if (source == null) throw new IllegalArgumentException("Formula field is missing");
                Object sourceValue = databaseValue(fields, row, source, new HashSet<>(seen));
                double number = sourceValue instanceof Number numeric
                        ? numeric.doubleValue()
                        : Double.parseDouble(String.valueOf(sourceValue));
                if (!Double.isFinite(number)) throw new IllegalArgumentException("Formula value is invalid");
                matcher.appendReplacement(expression, java.util.regex.Matcher.quoteReplacement(Double.toString(number)));
            }
            matcher.appendTail(expression);
            return new ArithmeticParser(expression.toString()).parse();
        } catch (RuntimeException exception) {
            return "#ERROR!";
        }
    }

    private static JsonNode fieldByName(JsonNode fields, String name) {
        for (JsonNode field : fields) {
            if (name.equals(text(field.path("name"), ""))) return field;
        }
        return null;
    }

    private static String databaseText(Object value) {
        if (value == null) return "";
        if (value instanceof Double number && number == Math.rint(number)) {
            return Long.toString(number.longValue());
        }
        return String.valueOf(value);
    }

    private static String csvEscape(String value) {
        return "\"" + value.replace("\"", "\"\"") + "\"";
    }

    private static String uniqueSheetName(XSSFWorkbook workbook, String requested, int index) {
        String safe = WorkbookUtil.createSafeSheetName(requested);
        if (safe == null || safe.isBlank()) safe = "Sheet " + (index + 1);
        safe = safe.substring(0, Math.min(31, safe.length()));
        String candidate = safe;
        int suffix = 2;
        while (workbook.getSheet(candidate) != null) {
            String ending = "-" + suffix++;
            candidate = safe.substring(0, Math.min(safe.length(), 31 - ending.length())) + ending;
        }
        return candidate;
    }

    private static Color color(String value, Color fallback) {
        try {
            return value.matches("#[0-9a-fA-F]{6}") ? Color.decode(value) : fallback;
        } catch (NumberFormatException ignored) {
            return fallback;
        }
    }

    private static String hexColor(String value) {
        Color color = color(value, Color.WHITE);
        return String.format(Locale.ROOT, "#%02x%02x%02x", color.getRed(), color.getGreen(), color.getBlue());
    }

    private static int clamp(int value, int minimum, int maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    private static String columnName(int column) {
        StringBuilder value = new StringBuilder();
        for (int index = column + 1; index > 0; index = (index - 1) / 26) {
            value.insert(0, (char) ('A' + (index - 1) % 26));
        }
        return value.toString();
    }

    private static String file(String title, String extension) {
        String value = title == null ? "structured-page" : title.toLowerCase(Locale.ROOT)
                .replaceAll("[^\\p{L}\\p{N}]+", "-").replaceAll("^-|-$", "");
        if (value.isBlank()) value = "structured-page";
        return value.substring(0, Math.min(value.length(), 120)) + "." + extension;
    }

    private static String escape(String value) {
        return value.replace("&", "&amp;").replace("<", "&lt;")
                .replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;");
    }

    private static final class ArithmeticParser {
        private final String source;
        private int index;

        private ArithmeticParser(String source) { this.source = source; }

        double parse() {
            double value = add();
            whitespace();
            if (index != source.length() || !Double.isFinite(value)) {
                throw new IllegalArgumentException("Formula expression is invalid");
            }
            return value;
        }

        private double add() {
            double value = multiply();
            while (true) {
                whitespace();
                if (take('+')) value += multiply();
                else if (take('-')) value -= multiply();
                else return value;
            }
        }

        private double multiply() {
            double value = primary();
            while (true) {
                whitespace();
                if (take('*')) value *= primary();
                else if (take('/')) value /= primary();
                else return value;
            }
        }

        private double primary() {
            whitespace();
            if (take('-')) return -primary();
            if (take('(')) {
                double value = add();
                whitespace();
                if (!take(')')) throw new IllegalArgumentException("Formula parenthesis is invalid");
                return value;
            }
            int start = index;
            while (index < source.length()
                    && (Character.isDigit(source.charAt(index)) || source.charAt(index) == '.')) index++;
            if (start == index) throw new IllegalArgumentException("Formula number is missing");
            return Double.parseDouble(source.substring(start, index));
        }

        private boolean take(char expected) {
            if (index < source.length() && source.charAt(index) == expected) {
                index++;
                return true;
            }
            return false;
        }

        private void whitespace() {
            while (index < source.length() && Character.isWhitespace(source.charAt(index))) index++;
        }
    }

    private record SceneBounds(int minX, int minY, int width, int height) {}
}
