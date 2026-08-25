package io.knowledge.platform.page;

import java.net.URI;
import java.io.StringReader;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.springframework.stereotype.Component;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.xml.sax.InputSource;

@Component
class ContentCardRegistry {

    private static final Set<String> EXPORTS = Set.of("MARKDOWN", "HTML", "PDF", "DOCX");
    private static final Map<String, Set<String>> PROVIDER_HOSTS = Map.of(
            "youtube", Set.of("youtube.com", "www.youtube.com", "youtu.be"),
            "bilibili", Set.of("bilibili.com", "www.bilibili.com", "b23.tv"),
            "figma", Set.of("figma.com", "www.figma.com"),
            "map", Set.of("amap.com", "www.amap.com", "maps.google.com"),
            "music", Set.of("music.163.com", "open.spotify.com"));

    private final ObjectMapper objectMapper;
    private final Map<String, ContentCardDefinition> definitions;

    ContentCardRegistry(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.definitions = definitions();
    }

    List<ContentCardDefinition> all() {
        return List.copyOf(definitions.values());
    }

    ContentCardDefinition find(String id) {
        return definitions.get(id);
    }

    void validate(String id, int version, JsonNode data) {
        ContentCardDefinition definition = definitions.get(id);
        if (definition == null) {
            return;
        }
        if (version < 1 || version > definition.version()) {
            throw new IllegalArgumentException("Unsupported content card schema version");
        }
        if (data == null || !data.isObject()) {
            throw new IllegalArgumentException("Content card data must be a JSON object");
        }
        switch (id) {
            case "poll" -> validatePoll(data);
            case "checkin" -> validateCheckin(data);
            case "calendar" -> validateCalendar(data);
            case "status" -> validateStatus(data);
            case "table" -> validateTable(data);
            case "gallery" -> validateGallery(data);
            case "sensitive-text" -> validateSensitiveText(data);
            case "mention" -> validateMention(data);
            case "kanban" -> validateKanban(data);
            case "database" -> validateDatabase(data);
            case "whiteboard", "excalidraw" -> validateDrawing(id, data);
            case "drawio" -> validateDrawio(data);
            case "columns" -> validateColumns(data);
            case "quote", "callout", "toggle", "code", "formula", "flowchart", "mermaid", "uml", "text-diagram", "mind-map" ->
                validateTextCard(id, data);
            case "image", "attachment", "audio", "video", "file-preview", "pdf", "office" ->
                validateMedia(id, data);
            case "youtube", "bilibili", "figma", "map", "music" ->
                validateProvider(id, data);
            default -> validateGeneric(data);
        }
    }

    private Map<String, ContentCardDefinition> definitions() {
        LinkedHashMap<String, ContentCardDefinition> values = new LinkedHashMap<>();
        add(values, "image", "图片", List.of("image", "img", "图片"), "基础", "image", false, false, object("url", "", "alt", "", "width", "LARGE"));
        add(values, "table", "表格", List.of("table", "表格"), "基础", "table", true, false, object("rows", List.of(List.of("", ""), List.of("", ""))));
        add(values, "attachment", "附件", List.of("attachment", "file", "附件"), "基础", "paperclip", false, false, object("name", "", "url", ""));
        add(values, "status", "状态", List.of("status", "状态", "进度"), "基础", "circle-dot", false, false, object("value", "TODO", "label", "待处理"));
        add(values, "whiteboard", "画板", List.of("whiteboard", "board", "画板"), "图形", "pen-tool", true, false, defaultDrawing("whiteboard"));
        add(values, "mind-map", "思维导图", List.of("mindmap", "mind-map", "思维导图"), "图形", "git-branch", true, false, defaultMindMap());
        add(values, "flowchart", "流程图", List.of("flowchart", "流程图"), "图形", "workflow", true, false, object("source", "graph TD\nA-->B"));
        add(values, "drawio", "Draw.io", List.of("drawio", "diagram"), "图形", "shapes", true, false, defaultDrawio());
        add(values, "excalidraw", "Excalidraw", List.of("excalidraw", "手绘"), "图形", "pencil", true, false, defaultDrawing("excalidraw"));
        add(values, "database", "数据表", List.of("database", "base", "数据表"), "数据", "database", true, false, defaultDatabase());
        add(values, "gallery", "画廊", List.of("gallery", "画廊", "相册"), "数据", "images", true, false, object("items", List.of()));
        add(values, "kanban", "看板", List.of("kanban", "board", "看板"), "数据", "columns", true, false, defaultKanban());
        add(values, "code", "代码块", List.of("code", "代码"), "技术", "code", false, false, object("language", "text", "code", ""));
        add(values, "formula", "数学公式", List.of("formula", "math", "latex", "公式"), "技术", "sigma", false, false, object("latex", ""));
        add(values, "mermaid", "Mermaid", List.of("mermaid", "流程图"), "技术", "workflow", true, false, object("source", "graph TD\nA-->B"));
        add(values, "uml", "UML", List.of("uml", "plantuml"), "技术", "boxes", true, false, object("source", "@startuml\n@enduml"));
        add(values, "text-diagram", "文本绘图", List.of("ascii", "text diagram", "文本绘图"), "技术", "terminal-square", false, false, object("source", ""));
        add(values, "callout", "提示框", List.of("callout", "提示", "高亮块"), "布局", "message-square", false, false, object("tone", "INFO", "text", ""));
        add(values, "toggle", "折叠块", List.of("toggle", "details", "折叠"), "布局", "chevrons-down", false, false, object("title", "折叠标题", "content", ""));
        add(values, "columns", "分栏", List.of("columns", "分栏"), "布局", "columns", true, false, defaultColumns());
        add(values, "quote", "引用", List.of("quote", "引用"), "布局", "quote", false, false, object("text", "", "source", ""));
        add(values, "divider", "分割线", List.of("divider", "hr", "分割线"), "布局", "minus", false, false, object());
        add(values, "poll", "投票", List.of("poll", "vote", "投票"), "协作", "list-checks", false, true, defaultPoll());
        add(values, "checkin", "打卡", List.of("checkin", "habit", "打卡"), "协作", "calendar-check", false, true, defaultCheckin());
        add(values, "calendar", "日历", List.of("calendar", "日历"), "协作", "calendar-days", true, false, object("timezone", "Asia/Shanghai", "events", List.of()));
        add(values, "mention", "提及", List.of("mention", "at", "提及"), "协作", "at-sign", false, false, object("userId", "", "label", ""));
        add(values, "sensitive-text", "敏感文字", List.of("sensitive", "encrypted", "加密文字"), "安全", "lock-keyhole", false, false, object("ciphertext", "", "salt", "", "iv", "", "kdf", "PBKDF2-SHA256", "iterations", 210_000, "hint", ""));
        add(values, "audio", "音频", List.of("audio", "voice", "音频", "语音"), "媒体", "audio-lines", false, false, object("url", "", "title", ""));
        add(values, "video", "视频", List.of("video", "视频"), "媒体", "video", true, false, object("url", "", "title", ""));
        add(values, "file-preview", "文件预览", List.of("preview", "file", "文件预览"), "媒体", "file-search", true, false, object("url", "", "name", ""));
        add(values, "pdf", "PDF", List.of("pdf", "PDF"), "媒体", "file-text", true, false, object("url", "", "page", 1));
        add(values, "office", "Office 文档", List.of("office", "word", "excel", "ppt"), "媒体", "files", true, false, object("url", "", "name", ""));
        add(values, "youtube", "YouTube", List.of("youtube", "油管"), "第三方", "youtube", true, false, object("url", ""));
        add(values, "bilibili", "哔哩哔哩", List.of("bilibili", "b站"), "第三方", "tv", true, false, object("url", ""));
        add(values, "music", "音乐", List.of("music", "spotify", "网易云", "音乐"), "第三方", "music", false, false, object("url", ""));
        add(values, "map", "地图", List.of("map", "地图"), "第三方", "map-pin", true, false, object("url", ""));
        add(values, "figma", "Figma", List.of("figma", "设计稿"), "第三方", "figma", true, false, object("url", ""));
        return Collections.unmodifiableMap(values);
    }

    private void add(
            Map<String, ContentCardDefinition> values,
            String id,
            String title,
            List<String> aliases,
            String category,
            String icon,
            boolean fullScreen,
            boolean interactive,
            JsonNode initialData) {
        values.put(
                id,
                new ContentCardDefinition(
                        id,
                        1,
                        title,
                        List.copyOf(aliases),
                        category,
                        icon,
                        fullScreen,
                        interactive,
                        EXPORTS,
                        initialData));
    }

    private JsonNode defaultPoll() {
        var data = objectMapper.createObjectNode();
        data.put("question", "你怎么看？");
        var options = data.putArray("options");
        options.addObject().put("id", "option-a").put("label", "选项 A");
        options.addObject().put("id", "option-b").put("label", "选项 B");
        data.put("multiple", false);
        data.put("anonymous", false);
        return data;
    }

    private JsonNode defaultCheckin() {
        LocalDate today = LocalDate.now();
        return object(
                "title", "每日打卡",
                "startDate", today.toString(),
                "endDate", today.plusDays(30).toString(),
                "timezone", "Asia/Shanghai");
    }

    private JsonNode defaultColumns() {
        var data = objectMapper.createObjectNode();
        data.put("count", 2);
        var columns = data.putArray("columns");
        columns.addObject().put("content", "左栏内容");
        columns.addObject().put("content", "右栏内容");
        var ratios = data.putArray("ratios");
        ratios.add(1);
        ratios.add(1);
        return data;
    }

    private JsonNode defaultKanban() {
        var data = objectMapper.createObjectNode();
        var columns = data.putArray("columns");
        columns.addObject().put("id", "todo").put("title", "待处理").putArray("cards");
        columns.addObject().put("id", "doing").put("title", "进行中").putArray("cards");
        columns.addObject().put("id", "done").put("title", "已完成").putArray("cards");
        return data;
    }

    private JsonNode defaultDatabase() {
        var data = objectMapper.createObjectNode();
        data.put("type", "database");
        data.put("view", "TABLE");
        data.put("filter", "");
        data.putNull("sortFieldId");
        var fields = data.putArray("fields");
        fields.addObject().put("id", "name").put("name", "名称").put("type", "TEXT");
        fields.addObject().put("id", "status").put("name", "状态").put("type", "SELECT")
                .putArray("options").add("待处理").add("进行中").add("已完成");
        fields.addObject().put("id", "date").put("name", "日期").put("type", "DATE");
        data.putArray("rows");
        return data;
    }

    private JsonNode defaultDrawing(String type) {
        var data = objectMapper.createObjectNode();
        data.put("type", type);
        data.putObject("viewport").put("x", 0).put("y", 0).put("zoom", 1);
        data.putArray("elements");
        return data;
    }

    private JsonNode defaultDrawio() {
        var data = objectMapper.createObjectNode();
        data.put("type", "drawio");
        data.put("xml", "<mxfile><diagram name=\"Page-1\"><mxGraphModel><root><mxCell id=\"0\"/><mxCell id=\"1\" parent=\"0\"/></root></mxGraphModel></diagram></mxfile>");
        data.putObject("viewport").put("x", 0).put("y", 0).put("zoom", 1);
        data.putArray("nodes");
        data.putArray("edges");
        return data;
    }

    private JsonNode defaultMindMap() {
        var data = objectMapper.createObjectNode();
        data.put("root", "中心主题");
        data.putArray("nodes");
        return data;
    }

    private JsonNode object(Object... pairs) {
        if (pairs.length % 2 != 0) {
            throw new IllegalArgumentException("Card default data requires key/value pairs");
        }
        var node = objectMapper.createObjectNode();
        for (int index = 0; index < pairs.length; index += 2) {
            node.set((String) pairs[index], objectMapper.valueToTree(pairs[index + 1]));
        }
        return node;
    }

    private static void validatePoll(JsonNode data) {
        requireText(data, "question", 1, 300);
        JsonNode options = data.path("options");
        if (!options.isArray() || options.size() < 2 || options.size() > 20) {
            throw new IllegalArgumentException("A poll requires between 2 and 20 options");
        }
        Set<String> ids = new java.util.HashSet<>();
        for (JsonNode option : options) {
            String id = requireText(option, "id", 1, 64);
            requireText(option, "label", 1, 200);
            if (!ids.add(id)) {
                throw new IllegalArgumentException("Poll option ids must be unique");
            }
        }
        String closesAt = data.path("closesAt").stringValue(null);
        if (closesAt != null) {
            OffsetDateTime.parse(closesAt);
        }
    }

    private static void validateCheckin(JsonNode data) {
        requireText(data, "title", 1, 200);
        LocalDate start = LocalDate.parse(requireText(data, "startDate", 10, 10));
        LocalDate end = LocalDate.parse(requireText(data, "endDate", 10, 10));
        if (end.isBefore(start) || end.isAfter(start.plusYears(2))) {
            throw new IllegalArgumentException("Check-in date range is invalid");
        }
        ZoneId.of(requireText(data, "timezone", 1, 80));
    }

    private static void validateCalendar(JsonNode data) {
        ZoneId.of(requireText(data, "timezone", 1, 80));
        JsonNode events = data.path("events");
        if (!events.isArray() || events.size() > 500) {
            throw new IllegalArgumentException("Calendar events are invalid");
        }
        Set<String> ids = new java.util.HashSet<>();
        for (JsonNode event : events) {
            String id = requireText(event, "id", 1, 64);
            requireText(event, "title", 1, 300);
            OffsetDateTime start = OffsetDateTime.parse(requireText(event, "start", 1, 64));
            String rawEnd = event.path("end").stringValue(null);
            if (rawEnd != null && !rawEnd.isBlank()) {
                OffsetDateTime end = OffsetDateTime.parse(rawEnd);
                if (end.isBefore(start) || end.isAfter(start.plusYears(2))) {
                    throw new IllegalArgumentException("Calendar event range is invalid");
                }
            }
            if (!ids.add(id)) {
                throw new IllegalArgumentException("Calendar event ids must be unique");
            }
        }
    }

    private static void validateStatus(JsonNode data) {
        String value = requireText(data, "value", 1, 32).toUpperCase(Locale.ROOT);
        if (!Set.of("TODO", "IN_PROGRESS", "BLOCKED", "DONE", "CANCELLED")
                .contains(value)) {
            throw new IllegalArgumentException("Card status is invalid");
        }
        requireText(data, "label", 1, 100);
    }

    private static void validateColumns(JsonNode data) {
        int count = data.path("count").asInt(0);
        JsonNode columns = data.path("columns");
        if (count < 2 || count > 4 || !columns.isArray() || columns.size() != count) {
            throw new IllegalArgumentException("A column layout requires between 2 and 4 columns");
        }
        for (JsonNode column : columns) {
            JsonNode content = column.path("content");
            if (!column.isObject()
                    || !content.isString()
                    || content.stringValue().length() > 20_000
                    || content.stringValue().contains("{{card:")) {
                throw new IllegalArgumentException("Column content is invalid");
            }
        }
        JsonNode ratios = data.path("ratios");
        if (!ratios.isMissingNode() && (!ratios.isArray() || ratios.size() != count)) {
            throw new IllegalArgumentException("Column ratios are invalid");
        }
        if (ratios.isArray()) {
            for (JsonNode ratio : ratios) {
                if (!ratio.isNumber() || ratio.doubleValue() <= 0 || ratio.doubleValue() > 10) {
                    throw new IllegalArgumentException("Column ratios are invalid");
                }
            }
        }
    }

    private static void validateTable(JsonNode data) {
        JsonNode rows = data.path("rows");
        if (!rows.isArray() || rows.isEmpty() || rows.size() > 200) {
            throw new IllegalArgumentException("A table requires between 1 and 200 rows");
        }
        int width = rows.path(0).isArray() ? rows.path(0).size() : 0;
        if (width < 1 || width > 20) {
            throw new IllegalArgumentException("A table requires between 1 and 20 columns");
        }
        for (JsonNode row : rows) {
            if (!row.isArray() || row.size() != width) {
                throw new IllegalArgumentException("Table rows must have a consistent width");
            }
            for (JsonNode cell : row) {
                if ((!cell.isString() && !cell.isNumber() && !cell.isBoolean() && !cell.isNull())
                        || cell.toString().length() > 2_000) {
                    throw new IllegalArgumentException("Table cell is invalid");
                }
            }
        }
    }

    private static void validateGallery(JsonNode data) {
        JsonNode items = data.path("items");
        if (!items.isArray() || items.isEmpty() || items.size() > 100) {
            throw new IllegalArgumentException("A gallery requires between 1 and 100 images");
        }
        Set<String> attachmentIds = new java.util.HashSet<>();
        for (JsonNode item : items) {
            if (!item.isObject()) {
                throw new IllegalArgumentException("Gallery image is invalid");
            }
            validateMedia("image", item);
            optionalText(item, "alt", 500);
            String attachmentId = item.path("attachmentId").stringValue(null);
            if (attachmentId != null && !attachmentIds.add(attachmentId)) {
                throw new IllegalArgumentException("Gallery attachment ids must be unique");
            }
        }
    }

    private static void validateSensitiveText(JsonNode data) {
        String ciphertext = requireText(data, "ciphertext", 23, 90_000);
        String salt = requireText(data, "salt", 22, 22);
        String iv = requireText(data, "iv", 16, 16);
        if (!ciphertext.matches("[A-Za-z0-9_-]+")
                || !salt.matches("[A-Za-z0-9_-]+")
                || !iv.matches("[A-Za-z0-9_-]+")
                || !"PBKDF2-SHA256".equals(requireText(data, "kdf", 1, 32))) {
            throw new IllegalArgumentException("Sensitive text encryption envelope is invalid");
        }
        try {
            int ciphertextBytes = Base64.getUrlDecoder().decode(ciphertext).length;
            if (ciphertextBytes < 17 || ciphertextBytes > 65_536
                    || Base64.getUrlDecoder().decode(salt).length != 16
                    || Base64.getUrlDecoder().decode(iv).length != 12) {
                throw new IllegalArgumentException("Sensitive text encryption envelope is invalid");
            }
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("Sensitive text encryption envelope is invalid");
        }
        int iterations = data.path("iterations").asInt(0);
        if (iterations < 100_000 || iterations > 1_000_000) {
            throw new IllegalArgumentException("Sensitive text iteration count is invalid");
        }
        optionalText(data, "hint", 300);
    }

    private static void validateMention(JsonNode data) {
        String userId = requireText(data, "userId", 36, 36);
        try {
            UUID.fromString(userId);
        } catch (IllegalArgumentException exception) {
            throw new IllegalArgumentException("Mentioned user id is invalid");
        }
        requireText(data, "label", 1, 200);
    }

    private static void validateKanban(JsonNode data) {
        JsonNode columns = data.path("columns");
        if (!columns.isArray() || columns.isEmpty() || columns.size() > 20) {
            throw new IllegalArgumentException("A kanban requires between 1 and 20 columns");
        }
        Set<String> ids = new java.util.HashSet<>();
        int totalCards = 0;
        for (JsonNode column : columns) {
            if (!column.isObject() || !ids.add(requireText(column, "id", 1, 64))) {
                throw new IllegalArgumentException("Kanban ids must be unique");
            }
            requireText(column, "title", 1, 100);
            optionalText(column, "color", 16);
            String color = column.path("color").stringValue(null);
            if (color != null && !color.isBlank() && !color.matches("#[0-9a-fA-F]{6}")) {
                throw new IllegalArgumentException("Kanban column color is invalid");
            }
            JsonNode cards = column.path("cards");
            if (!cards.isArray() || cards.size() > 200) {
                throw new IllegalArgumentException("Kanban cards are invalid");
            }
            totalCards += cards.size();
            for (JsonNode card : cards) {
                if (!card.isObject() || !ids.add(requireText(card, "id", 1, 64))) {
                    throw new IllegalArgumentException("Kanban ids must be unique");
                }
                requireText(card, "title", 1, 300);
                optionalText(card, "description", 2_000);
            }
        }
        if (totalCards > 500) {
            throw new IllegalArgumentException("A kanban cannot contain more than 500 cards");
        }
    }

    private static void validateDatabase(JsonNode data) {
        if (!"database".equals(data.path("type").stringValue(null))) {
            throw new IllegalArgumentException("Database card type is invalid");
        }
        String view = requireText(data, "view", 1, 16).toUpperCase(Locale.ROOT);
        if (!Set.of("TABLE", "KANBAN", "GALLERY", "CALENDAR").contains(view)) {
            throw new IllegalArgumentException("Database view is invalid");
        }
        optionalText(data, "filter", 300);
        JsonNode fields = data.path("fields");
        if (!fields.isArray() || fields.isEmpty() || fields.size() > 50) {
            throw new IllegalArgumentException("A database requires between 1 and 50 fields");
        }
        Set<String> fieldIds = new java.util.HashSet<>();
        Set<String> fieldNames = new java.util.HashSet<>();
        for (JsonNode field : fields) {
            String id = requireText(field, "id", 1, 64);
            String name = requireText(field, "name", 1, 100);
            String type = requireText(field, "type", 1, 32).toUpperCase(Locale.ROOT);
            if (!fieldIds.add(id) || !fieldNames.add(name.toLowerCase(Locale.ROOT))
                    || !Set.of("TEXT", "NUMBER", "SELECT", "MULTI_SELECT", "DATE", "PERSON", "CHECKBOX", "URL", "EMAIL", "FILE", "FORMULA", "RELATION", "ROLLUP").contains(type)) {
                throw new IllegalArgumentException("Database field is invalid");
            }
            if (Set.of("SELECT", "MULTI_SELECT").contains(type)) {
                JsonNode options = field.path("options");
                if (!options.isArray() || options.size() > 100) {
                    throw new IllegalArgumentException("Database field options are invalid");
                }
                Set<String> optionValues = new java.util.HashSet<>();
                for (JsonNode option : options) {
                    if (!option.isString() || option.stringValue().isBlank()
                            || option.stringValue().length() > 100
                            || !optionValues.add(option.stringValue())) {
                        throw new IllegalArgumentException("Database field options are invalid");
                    }
                }
            }
            if (Set.of("FORMULA", "ROLLUP").contains(type)) optionalText(field, "formula", 2_000);
        }
        String sortFieldId = data.path("sortFieldId").stringValue(null);
        if (sortFieldId != null && !fieldIds.contains(sortFieldId)) {
            throw new IllegalArgumentException("Database sort field is invalid");
        }
        JsonNode rows = data.path("rows");
        if (!rows.isArray() || rows.size() > 1_000) {
            throw new IllegalArgumentException("Database rows are invalid");
        }
        Set<String> rowIds = new java.util.HashSet<>();
        for (JsonNode row : rows) {
            if (!row.isObject() || !rowIds.add(requireText(row, "id", 1, 64)) || !row.path("values").isObject()) {
                throw new IllegalArgumentException("Database row is invalid");
            }
            optionalText(row, "createdAt", 64);
            for (var property : row.path("values").properties()) {
                if (!fieldIds.contains(property.getKey()) || property.getValue().toString().length() > 4_000) {
                    throw new IllegalArgumentException("Database cell is invalid");
                }
                JsonNode value = property.getValue();
                if (!value.isNull() && !value.isString() && !value.isNumber() && !value.isBoolean()
                        && !(value.isArray() && value.size() <= 100)) {
                    throw new IllegalArgumentException("Database cell is invalid");
                }
            }
        }
    }

    private static void validateDrawing(String cardId, JsonNode data) {
        if (!cardId.equals(data.path("type").stringValue(null)) || data.toString().length() > 256_000) {
            throw new IllegalArgumentException("Drawing data is invalid");
        }
        validateViewport(data.path("viewport"));
        JsonNode elements = data.path("elements");
        if (!elements.isArray() || elements.size() > 500) {
            throw new IllegalArgumentException("Drawing elements are invalid");
        }
        Set<String> ids = new java.util.HashSet<>();
        Set<String> kinds = Set.of("RECT", "ELLIPSE", "DIAMOND", "STICKY", "TEXT", "ARROW", "FREEDRAW");
        for (JsonNode element : elements) {
            if (!element.isObject() || !ids.add(requireText(element, "id", 1, 64))) {
                throw new IllegalArgumentException("Drawing element is invalid");
            }
            String kind = requireText(element, "kind", 1, 16).toUpperCase(Locale.ROOT);
            if (!kinds.contains(kind)) {
                throw new IllegalArgumentException("Drawing element kind is invalid");
            }
            requireFinite(element, "x", -100_000, 100_000);
            requireFinite(element, "y", -100_000, 100_000);
            requireFinite(element, "width", 1, 20_000);
            requireFinite(element, "height", 1, 20_000);
            optionalText(element, "text", 4_000);
            String color = element.path("color").stringValue("#ffffff");
            if (!color.matches("#[0-9a-fA-F]{6}")) {
                throw new IllegalArgumentException("Drawing color is invalid");
            }
            JsonNode points = element.path("points");
            if ("FREEDRAW".equals(kind)) {
                if (!points.isArray() || points.size() < 2 || points.size() > 2_000) {
                    throw new IllegalArgumentException("Freehand points are invalid");
                }
                for (JsonNode point : points) {
                    if (!point.isArray() || point.size() != 2
                            || !finite(point.path(0), -20_000, 20_000)
                            || !finite(point.path(1), -20_000, 20_000)) {
                        throw new IllegalArgumentException("Freehand point is invalid");
                    }
                }
            } else if (!points.isMissingNode() && !points.isArray()) {
                throw new IllegalArgumentException("Drawing points are invalid");
            }
        }
    }

    private static void validateDrawio(JsonNode data) {
        if (!"drawio".equals(data.path("type").stringValue(null)) || data.toString().length() > 256_000) {
            throw new IllegalArgumentException("Draw.io data is invalid");
        }
        validateViewport(data.path("viewport"));
        JsonNode nodes = data.path("nodes");
        JsonNode edges = data.path("edges");
        if (!nodes.isArray() || nodes.size() > 500 || !edges.isArray() || edges.size() > 1_000) {
            throw new IllegalArgumentException("Draw.io graph is invalid");
        }
        Set<String> ids = new java.util.HashSet<>();
        Set<String> nodeIds = new java.util.HashSet<>();
        for (JsonNode node : nodes) {
            String id = requireText(node, "id", 1, 64);
            if (!node.isObject() || !ids.add(id) || !nodeIds.add(id)
                    || !Set.of("RECT", "ELLIPSE", "DIAMOND", "TEXT")
                            .contains(requireText(node, "kind", 1, 16).toUpperCase(Locale.ROOT))) {
                throw new IllegalArgumentException("Draw.io node is invalid");
            }
            requireFinite(node, "x", -100_000, 100_000);
            requireFinite(node, "y", -100_000, 100_000);
            requireFinite(node, "width", 1, 20_000);
            requireFinite(node, "height", 1, 20_000);
            optionalText(node, "text", 4_000);
            String color = node.path("color").stringValue("#ffffff");
            if (!color.matches("#[0-9a-fA-F]{6}")) {
                throw new IllegalArgumentException("Draw.io node color is invalid");
            }
        }
        for (JsonNode edge : edges) {
            String id = requireText(edge, "id", 1, 64);
            String source = requireText(edge, "source", 1, 64);
            String target = requireText(edge, "target", 1, 64);
            if (!edge.isObject() || !ids.add(id) || source.equals(target)
                    || !nodeIds.contains(source) || !nodeIds.contains(target)) {
                throw new IllegalArgumentException("Draw.io edge is invalid");
            }
            optionalText(edge, "label", 1_000);
        }
        validateDrawioXml(requireText(data, "xml", 1, 250_000));
    }

    private static void validateViewport(JsonNode viewport) {
        if (!viewport.isObject()) {
            throw new IllegalArgumentException("Drawing viewport is invalid");
        }
        requireFinite(viewport, "x", -100_000, 100_000);
        requireFinite(viewport, "y", -100_000, 100_000);
        requireFinite(viewport, "zoom", 0.1, 5);
    }

    private static void validateDrawioXml(String xml) {
        if (xml.contains("<!DOCTYPE") || xml.contains("<!ENTITY")) {
            throw new IllegalArgumentException("Draw.io XML is unsafe");
        }
        try {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);
            var document = factory.newDocumentBuilder().parse(new InputSource(new StringReader(xml)));
            String root = document.getDocumentElement().getTagName();
            if (!"mxfile".equals(root) && !"mxGraphModel".equals(root)) {
                throw new IllegalArgumentException("Draw.io XML root is invalid");
            }
        } catch (IllegalArgumentException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new IllegalArgumentException("Draw.io XML is invalid", exception);
        }
    }

    private static double requireFinite(JsonNode data, String field, double minimum, double maximum) {
        JsonNode value = data.path(field);
        if (!finite(value, minimum, maximum)) {
            throw new IllegalArgumentException("Drawing coordinate is invalid: " + field);
        }
        return value.doubleValue();
    }

    private static boolean finite(JsonNode value, double minimum, double maximum) {
        if (!value.isNumber()) return false;
        double number = value.doubleValue();
        return Double.isFinite(number) && number >= minimum && number <= maximum;
    }

    private static void validateTextCard(String id, JsonNode data) {
        switch (id) {
            case "quote" -> {
                requireText(data, "text", 1, 20_000);
                optionalText(data, "source", 300);
            }
            case "callout" -> {
                String tone = requireText(data, "tone", 1, 16).toUpperCase(Locale.ROOT);
                if (!Set.of("INFO", "SUCCESS", "WARNING", "DANGER").contains(tone)) {
                    throw new IllegalArgumentException("Callout tone is invalid");
                }
                requireText(data, "text", 1, 20_000);
            }
            case "toggle" -> {
                requireText(data, "title", 1, 300);
                optionalText(data, "content", 20_000);
            }
            case "code" -> {
                String language = requireText(data, "language", 1, 30);
                if (!language.matches("[A-Za-z0-9_+.-]+")) {
                    throw new IllegalArgumentException("Code language is invalid");
                }
                optionalText(data, "code", 64_000);
            }
            case "formula" -> requireText(data, "latex", 1, 20_000);
            case "flowchart", "mermaid", "uml", "text-diagram" ->
                requireText(data, "source", 1, 64_000);
            case "mind-map" -> validateMindMap(data);
            default -> throw new IllegalArgumentException("Unsupported text card");
        }
    }

    private static void validateMindMap(JsonNode data) {
        requireText(data, "root", 1, 300);
        JsonNode nodes = data.path("nodes");
        if (nodes.isMissingNode()) return;
        if (!nodes.isArray() || nodes.size() > 500) {
            throw new IllegalArgumentException("Mind map nodes are invalid");
        }
        Set<String> ids = new java.util.HashSet<>();
        Map<String, String> parents = new java.util.HashMap<>();
        for (JsonNode node : nodes) {
            if (!node.isObject()) throw new IllegalArgumentException("Mind map node is invalid");
            String id = requireText(node, "id", 1, 64);
            if (!ids.add(id)) throw new IllegalArgumentException("Mind map node ids must be unique");
            requireText(node, "text", 1, 300);
            JsonNode parent = node.path("parentId");
            if (!parent.isMissingNode() && !parent.isNull()) {
                String parentId = requireText(node, "parentId", 1, 64);
                if (parentId.equals(id)) throw new IllegalArgumentException("Mind map cannot contain cycles");
                parents.put(id, parentId);
            }
        }
        if (!ids.containsAll(parents.values())) {
            throw new IllegalArgumentException("Mind map parent is invalid");
        }
        for (String id : ids) {
            Set<String> visited = new java.util.HashSet<>();
            String current = id;
            while (parents.containsKey(current)) {
                if (!visited.add(current)) throw new IllegalArgumentException("Mind map cannot contain cycles");
                current = parents.get(current);
            }
        }
    }

    private static void validateProvider(String provider, JsonNode data) {
        String rawUrl = requireText(data, "url", 1, 2_000);
        URI uri = URI.create(rawUrl);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                || uri.getUserInfo() != null || hasControlCharacter(rawUrl)) {
            throw new IllegalArgumentException("Third-party embeds require an HTTPS URL");
        }
        String host = uri.getHost().toLowerCase(Locale.ROOT);
        boolean allowed = PROVIDER_HOSTS.getOrDefault(provider, Set.of()).stream()
                .anyMatch(candidate -> host.equals(candidate) || host.endsWith("." + candidate));
        if (!allowed) {
            throw new IllegalArgumentException("Third-party embed host is not allowed");
        }
    }

    private static void validateMedia(String cardId, JsonNode data) {
        if ("image".equals(cardId) && data.has("width")) {
            String width = requireText(data, "width", 1, 16).toUpperCase(Locale.ROOT);
            if (!Set.of("SMALL", "MEDIUM", "LARGE", "FULL").contains(width)) {
                throw new IllegalArgumentException("Image width is invalid");
            }
        }
        String rawUrl = requireText(data, "url", 1, 2_000);
        if (rawUrl.matches("/api/v1/attachments/[0-9a-fA-F-]{36}/content")) {
            return;
        }
        URI uri = URI.create(rawUrl);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                || uri.getUserInfo() != null || hasControlCharacter(rawUrl)) {
            throw new IllegalArgumentException("Media cards require an attachment or HTTPS URL");
        }
    }

    private static boolean hasControlCharacter(String value) {
        return value.chars().anyMatch(Character::isISOControl);
    }

    private static void validateGeneric(JsonNode data) {
        if (data.toString().length() > 64_000) {
            throw new IllegalArgumentException("Content card data is too large");
        }
    }

    private static String requireText(
            JsonNode data,
            String field,
            int minimum,
            int maximum) {
        String value = data.path(field).stringValue(null);
        if (value == null || value.trim().length() < minimum || value.trim().length() > maximum) {
            throw new IllegalArgumentException("Content card field is invalid: " + field);
        }
        return value.trim();
    }

    private static void optionalText(JsonNode data, String field, int maximum) {
        JsonNode value = data.path(field);
        if (!value.isMissingNode() && (!value.isString() || value.stringValue().length() > maximum)) {
            throw new IllegalArgumentException("Content card field is invalid: " + field);
        }
    }
}
