package io.knowledge.platform;

import org.junit.jupiter.api.Test;
import org.springframework.modulith.core.ApplicationModules;

class ArchitectureTest {

    @Test
    void verifiesApplicationModuleBoundaries() {
        ApplicationModules.of(KnowledgePlatformApplication.class).verify();
    }
}

