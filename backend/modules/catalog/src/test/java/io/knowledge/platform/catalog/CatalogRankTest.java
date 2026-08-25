package io.knowledge.platform.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class CatalogRankTest {

    @Test
    void createsLexicographicallyOrderedRanks() {
        List<String> ranks = CatalogRank.evenlySpaced(3);

        assertThat(ranks).hasSize(3).isSorted();
        assertThat(CatalogRank.between(ranks.get(0), ranks.get(1)))
                .isBetween(ranks.get(0), ranks.get(1));
    }
}
