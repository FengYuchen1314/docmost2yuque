package io.knowledge.platform.common;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class EmailAddressTest {

    @Test
    void normalizesEmailForIdentityComparison() {
        EmailAddress email = EmailAddress.parse("  Admin@Example.COM ");

        assertEquals("Admin@Example.COM", email.original());
        assertEquals("admin@example.com", email.normalized());
    }

    @Test
    void rejectsMalformedEmail() {
        assertThrows(IllegalArgumentException.class, () -> EmailAddress.parse("not-an-email"));
    }
}

