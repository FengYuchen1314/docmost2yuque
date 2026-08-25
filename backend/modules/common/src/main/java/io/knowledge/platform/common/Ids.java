package io.knowledge.platform.common;

import java.security.SecureRandom;
import java.time.Clock;
import java.util.UUID;

public final class Ids {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final Object LOCK = new Object();
    private static long lastUnixMillis = -1;
    private static int sequence = -1;

    private Ids() {}

    public static UUID next() {
        return next(Clock.systemUTC());
    }

    static UUID next(Clock clock) {
        synchronized (LOCK) {
            long unixMillis = Math.max(clock.millis(), lastUnixMillis);
            if (unixMillis == lastUnixMillis) {
                sequence++;
                if (sequence > 0x0fff) {
                    unixMillis++;
                    sequence = RANDOM.nextInt(0x1000);
                }
            } else {
                sequence = RANDOM.nextInt(0x1000);
            }
            lastUnixMillis = unixMillis;

            long mostSignificantBits = ((unixMillis & 0x0000ffffffffffffL) << 16)
                    | 0x7000L
                    | sequence;
            long leastSignificantBits = (RANDOM.nextLong() & 0x3fffffffffffffffL)
                    | 0x8000000000000000L;
            return new UUID(mostSignificantBits, leastSignificantBits);
        }
    }
}
