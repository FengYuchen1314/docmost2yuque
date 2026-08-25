package io.knowledge.platform.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class IdsTest {

    @Test
    void createsMonotonicallyOrderedVersionSevenIdentifiers() {
        Clock fixed = Clock.fixed(Instant.parse("2026-08-24T00:00:00Z"), ZoneOffset.UTC);

        UUID first = Ids.next(fixed);
        UUID second = Ids.next(fixed);

        assertThat(first.version()).isEqualTo(7);
        assertThat(first.variant()).isEqualTo(2);
        assertThat(Long.compareUnsigned(first.getMostSignificantBits(), second.getMostSignificantBits()))
                .isNegative();
    }
}
