package io.knowledge.platform.page;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class ContentCardScheduleTest {

    private final ObjectMapper mapper = new ObjectMapper();
    private final ContentCardRegistry registry = new ContentCardRegistry(mapper);

    @Test
    void validatesCalendarEventsAndTheirRanges() {
        var valid = mapper.createObjectNode().put("timezone", "Asia/Shanghai");
        valid.putArray("events")
                .addObject()
                .put("id", "launch")
                .put("title", "发布")
                .put("start", "2026-08-24T10:00:00+08:00")
                .put("end", "2026-08-24T11:00:00+08:00");
        registry.validate("calendar", 1, valid);

        var reversed = valid.deepCopy();
        reversed.path("events").path(0).asObject().put("end", "2026-08-24T09:00:00+08:00");
        assertThatThrownBy(() -> registry.validate("calendar", 1, reversed))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Calendar event range is invalid");

        var duplicate = valid.deepCopy();
        duplicate.path("events").asArray().add(valid.path("events").path(0).deepCopy());
        assertThatThrownBy(() -> registry.validate("calendar", 1, duplicate))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("Calendar event ids must be unique");
    }
}
