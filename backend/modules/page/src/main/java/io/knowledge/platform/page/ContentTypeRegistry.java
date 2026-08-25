package io.knowledge.platform.page;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class ContentTypeRegistry {

    private final Map<ContentType, ContentTypeAdapter> adapters;

    public ContentTypeRegistry(List<ContentTypeAdapter> adapters) {
        EnumMap<ContentType, ContentTypeAdapter> values = new EnumMap<>(ContentType.class);
        for (ContentTypeAdapter adapter : adapters) {
            ContentTypeAdapter previous = values.put(adapter.type(), adapter);
            if (previous != null) {
                throw new IllegalStateException(
                        "Duplicate content type adapter: " + adapter.type());
            }
        }
        for (ContentType type : ContentType.values()) {
            if (!values.containsKey(type)) {
                throw new IllegalStateException("Missing content type adapter: " + type);
            }
        }
        this.adapters = Map.copyOf(values);
    }

    public ContentTypeAdapter require(ContentType type) {
        ContentTypeAdapter adapter = adapters.get(type);
        if (adapter == null) {
            throw new IllegalArgumentException("Unsupported content type");
        }
        return adapter;
    }
}
