package io.knowledge.platform.page;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

@Component
public class ContentCardExportService {

    private static final Pattern TOKEN = Pattern.compile(
            "\\{\\{card:([a-z0-9-]{1,64})\\|id=[0-9a-fA-F-]{36}\\|v=[1-9][0-9]{0,4}\\|data=([A-Za-z0-9_-]{1,350000})}}",
            Pattern.CASE_INSENSITIVE);
    private final ObjectMapper mapper;

    public ContentCardExportService(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public String markdown(String value) {
        return transform(value, true);
    }

    public String plainText(String value) {
        return transform(value, false);
    }

    private String transform(String value, boolean markdown) {
        if (value == null || value.isEmpty()) return "";
        Matcher matcher = TOKEN.matcher(value);
        StringBuilder result = new StringBuilder(value.length());
        while (matcher.find()) {
            String replacement;
            try {
                byte[] decoded = Base64.getUrlDecoder().decode(matcher.group(2));
                JsonNode data = mapper.readTree(new String(decoded, StandardCharsets.UTF_8));
                replacement = markdown
                        ? markdownCard(matcher.group(1).toLowerCase(Locale.ROOT), data)
                        : plainCard(matcher.group(1).toLowerCase(Locale.ROOT), data);
            } catch (RuntimeException exception) {
                replacement = "[无法导出的内容卡片]";
            }
            matcher.appendReplacement(result, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(result);
        return result.toString();
    }

    private String markdownCard(String id, JsonNode data) {
        return switch (id) {
            case "columns" -> columns(data, true);
            case "image" -> "![" + label(text(data, "alt", "图片")) + "](" + url(data) + ")";
            case "attachment", "file-preview", "pdf", "office" ->
                "[" + label(text(data, "name", "附件")) + "](" + url(data) + ")";
            case "audio", "video" ->
                "[" + label(text(data, "title", "媒体")) + "](" + url(data) + ")";
            case "gallery" -> gallery(data, true);
            case "quote" -> "> " + text(data, "text", "引用")
                    + optional(data, "source", "\n> — ");
            case "callout" -> "> **" + label(text(data, "tone", "提示")) + "** "
                    + text(data, "text", "");
            case "toggle" -> "**" + label(text(data, "title", "折叠内容")) + "**\n\n"
                    + text(data, "content", "");
            case "divider" -> "---";
            case "status" -> "**状态：" + label(text(data, "label", text(data, "value", ""))) + "**";
            case "code", "mermaid", "uml", "text-diagram", "flowchart" -> code(data, id);
            case "formula" -> "$$\n" + text(data, "latex", "") + "\n$$";
            case "table" -> table(data);
            case "poll" -> poll(data);
            case "checkin" -> "**打卡：" + label(text(data, "title", "每日打卡")) + "**";
            case "calendar" -> calendar(data, true);
            case "mind-map" -> mindMap(data, true);
            case "sensitive-text" -> "[受保护的敏感内容：" + label(text(data, "hint", "需要密码查看")) + "]";
            case "mention" -> "@" + label(text(data, "label", "成员"));
            case "kanban" -> kanban(data, true);
            case "database" -> database(data, true);
            case "whiteboard", "excalidraw" -> drawing(data, true, id);
            case "drawio" -> drawio(data, true);
            default -> "[内容卡片：" + label(id) + "]";
        };
    }

    private String plainCard(String id, JsonNode data) {
        return switch (id) {
            case "columns" -> columns(data, false);
            case "image" -> text(data, "alt", "图片");
            case "attachment", "file-preview", "pdf", "office" -> text(data, "name", "附件");
            case "audio", "video" -> text(data, "title", "媒体");
            case "gallery" -> gallery(data, false);
            case "quote" -> text(data, "text", "引用") + optional(data, "source", " — ");
            case "callout" -> text(data, "tone", "提示") + "：" + text(data, "text", "");
            case "toggle" -> text(data, "title", "折叠内容") + "\n" + text(data, "content", "");
            case "divider" -> "";
            case "status" -> "状态：" + text(data, "label", text(data, "value", ""));
            case "code", "mermaid", "uml", "text-diagram", "flowchart" ->
                text(data, "code", text(data, "source", ""));
            case "formula" -> text(data, "latex", "");
            case "table" -> plainTable(data);
            case "poll" -> text(data, "question", "投票");
            case "checkin" -> "打卡：" + text(data, "title", "每日打卡");
            case "calendar" -> calendar(data, false);
            case "mind-map" -> mindMap(data, false);
            case "sensitive-text" -> "受保护的敏感内容";
            case "mention" -> "@" + text(data, "label", "成员");
            case "kanban" -> kanban(data, false);
            case "database" -> database(data, false);
            case "whiteboard", "excalidraw" -> drawing(data, false, id);
            case "drawio" -> drawio(data, false);
            default -> "内容卡片：" + id;
        };
    }

    private String columns(JsonNode data, boolean markdown) {
        StringBuilder result = new StringBuilder();
        int index = 0;
        for (JsonNode column : data.path("columns")) {
            if (index > 0) result.append(markdown ? "\n\n---\n\n" : "\n\n");
            index++;
            String content = text(column, "content", "");
            if (markdown) result.append("#### 第 ").append(index).append(" 栏\n\n").append(content);
            else result.append("第 ").append(index).append(" 栏\n").append(content);
        }
        return result.toString();
    }

    private static String kanban(JsonNode data, boolean markdown) {
        StringBuilder result = new StringBuilder();
        for (JsonNode column : data.path("columns")) {
            if (!result.isEmpty()) result.append("\n\n");
            result.append(markdown ? "### " : "").append(text(column, "title", "看板列"));
            for (JsonNode card : column.path("cards")) {
                result.append("\n").append(markdown ? "- [ ] " : "- ")
                        .append(text(card, "title", "未命名卡片"));
                String description = card.path("description").stringValue(null);
                if (description != null && !description.isBlank()) {
                    result.append(markdown ? " — " : "：").append(description);
                }
            }
        }
        return result.toString();
    }

    private static String code(JsonNode data, String fallbackLanguage) {
        String language = text(data, "language", fallbackLanguage);
        if (!language.matches("[A-Za-z0-9_+.-]{0,30}")) language = "";
        String source = text(data, "code", text(data, "source", ""));
        String fence = source.contains("```") ? "````" : "```";
        return fence + language + "\n" + source + "\n" + fence;
    }

    private static String drawing(JsonNode data, boolean markdown, String id) {
        String title = "excalidraw".equals(id) ? "Excalidraw 手绘" : "画板";
        StringBuilder result = new StringBuilder(markdown ? "**" + title + "**" : title);
        for (JsonNode element : data.path("elements")) {
            String text = text(element, "text", "").strip();
            if (!text.isBlank()) result.append("\n- ").append(markdown ? label(text) : text);
        }
        return result.toString();
    }

    private static String drawio(JsonNode data, boolean markdown) {
        StringBuilder result = new StringBuilder(markdown ? "**Draw.io 图表**" : "Draw.io 图表");
        for (JsonNode node : data.path("nodes")) {
            String text = text(node, "text", "").strip();
            if (!text.isBlank()) result.append("\n- ").append(markdown ? label(text) : text);
        }
        return result.toString();
    }

    private static String mindMap(JsonNode data, boolean markdown) {
        String root = text(data, "root", "中心主题");
        StringBuilder result = new StringBuilder(markdown ? "**思维导图：" + label(root) + "**" : "思维导图：" + root);
        Map<String, java.util.List<JsonNode>> children = new java.util.LinkedHashMap<>();
        for (JsonNode node : data.path("nodes")) {
            JsonNode parent = node.path("parentId");
            String parentId = parent.isString() ? parent.stringValue() : "";
            children.computeIfAbsent(parentId, ignored -> new java.util.ArrayList<>()).add(node);
        }
        appendMindMap(children, "", 0, result, markdown, new java.util.HashSet<>());
        return result.toString();
    }

    private static void appendMindMap(
            Map<String, java.util.List<JsonNode>> children,
            String parentId,
            int depth,
            StringBuilder result,
            boolean markdown,
            Set<String> visited) {
        for (JsonNode node : children.getOrDefault(parentId, java.util.List.of())) {
            String id = text(node, "id", "");
            if (!visited.add(id)) continue;
            result.append('\n').append("  ".repeat(Math.min(depth, 20))).append("- ")
                    .append(markdown ? label(text(node, "text", "未命名主题")) : text(node, "text", "未命名主题"));
            appendMindMap(children, id, depth + 1, result, markdown, visited);
        }
    }

    private static String table(JsonNode data) {
        JsonNode rows = data.path("rows");
        if (!rows.isArray() || rows.isEmpty()) return "[空表格]";
        StringBuilder result = new StringBuilder();
        int width = rows.get(0).isArray() ? rows.get(0).size() : 0;
        for (int rowIndex = 0; rowIndex < rows.size(); rowIndex++) {
            JsonNode row = rows.get(rowIndex);
            if (!row.isArray()) continue;
            result.append("| ");
            for (int column = 0; column < width; column++) {
                result.append(label(row.path(column).stringValue(""))).append(" | ");
            }
            result.append('\n');
            if (rowIndex == 0) result.append("| ").append("--- | ".repeat(width)).append('\n');
        }
        return result.toString().stripTrailing();
    }

    private static String plainTable(JsonNode data) {
        JsonNode rows = data.path("rows");
        if (!rows.isArray()) return "";
        StringBuilder result = new StringBuilder();
        for (JsonNode row : rows) {
            if (!row.isArray()) continue;
            if (!result.isEmpty()) result.append('\n');
            for (int column = 0; column < row.size(); column++) {
                if (column > 0) result.append('\t');
                result.append(scalar(row.path(column)));
            }
        }
        return result.toString();
    }

    private static String scalar(JsonNode value) {
        if (value.isString()) return value.stringValue();
        if (value.isNumber()) return value.toString();
        if (value.isBoolean()) return Boolean.toString(value.booleanValue());
        return "";
    }

    private static String database(JsonNode data, boolean markdown) {
        JsonNode fields = data.path("fields");
        JsonNode rows = data.path("rows");
        if (!fields.isArray() || fields.isEmpty() || !rows.isArray()) return "";
        StringBuilder result = new StringBuilder();
        if (markdown) {
            result.append("| ");
            for (JsonNode field : fields) result.append(label(text(field, "name", "字段"))).append(" | ");
            result.append("\n| ").append("--- | ".repeat(fields.size()));
        } else {
            for (int index = 0; index < fields.size(); index++) {
                if (index > 0) result.append('\t');
                result.append(text(fields.path(index), "name", "字段"));
            }
        }
        for (JsonNode row : rows) {
            result.append(markdown ? "\n| " : "\n");
            JsonNode values = row.path("values");
            for (int index = 0; index < fields.size(); index++) {
                if (!markdown && index > 0) result.append('\t');
                JsonNode value = values.path(text(fields.path(index), "id", ""));
                String rendered = value.isArray()
                        ? String.join(", ", java.util.stream.StreamSupport.stream(value.spliterator(), false)
                                .map(ContentCardExportService::scalar).toList())
                        : scalar(value);
                result.append(markdown ? label(rendered) + " | " : rendered);
            }
        }
        return result.toString();
    }

    private static String poll(JsonNode data) {
        StringBuilder result = new StringBuilder("**投票：")
                .append(label(text(data, "question", "投票"))).append("**");
        for (JsonNode option : data.path("options")) {
            result.append("\n- [ ] ").append(label(text(option, "label", "选项")));
        }
        return result.toString();
    }

    private static String calendar(JsonNode data, boolean markdown) {
        StringBuilder result = new StringBuilder(markdown ? "**日历**" : "日历");
        for (JsonNode event : data.path("events")) {
            result.append("\n- ")
                    .append(label(text(event, "start", "")))
                    .append(" ")
                    .append(label(text(event, "title", "未命名日程")));
            String end = text(event, "end", "");
            if (!end.isBlank()) result.append(" — ").append(label(end));
        }
        return result.toString();
    }

    private static String gallery(JsonNode data, boolean markdown) {
        StringBuilder result = new StringBuilder();
        for (JsonNode item : data.path("items")) {
            if (!result.isEmpty()) result.append('\n');
            String alt = label(text(item, "alt", "图片"));
            if (markdown) result.append("![").append(alt).append("](").append(url(item)).append(")");
            else result.append(alt);
        }
        return result.toString();
    }

    private static String text(JsonNode data, String field, String fallback) {
        JsonNode value = data == null ? null : data.path(field);
        return value != null && value.isString() ? value.stringValue() : fallback;
    }

    private static String optional(JsonNode data, String field, String prefix) {
        String value = text(data, field, "");
        return value.isBlank() ? "" : prefix + value;
    }

    private static String url(JsonNode data) {
        return text(data, "url", "").replace(" ", "%20").replace(")", "%29");
    }

    private static String label(String value) {
        return value.replace("\\", "\\\\")
                .replace("[", "\\[")
                .replace("]", "\\]")
                .replace("|", "\\|")
                .replace("\r", " ")
                .replace("\n", " ");
    }
}
