package io.knowledge.platform.catalog;

import java.math.BigInteger;
import java.util.List;

final class CatalogRank {

    static final int WIDTH = 39;
    static final BigInteger MIN = BigInteger.ZERO;
    static final BigInteger MAX = BigInteger.TEN.pow(WIDTH).subtract(BigInteger.ONE);

    private CatalogRank() {}

    static String between(String lower, String upper) {
        BigInteger low = lower == null ? MIN : parse(lower);
        BigInteger high = upper == null ? MAX : parse(upper);
        if (low.compareTo(high) >= 0 || high.subtract(low).compareTo(BigInteger.ONE) <= 0) {
            return null;
        }
        return format(low.add(high).divide(BigInteger.TWO));
    }

    static List<String> evenlySpaced(int size) {
        if (size < 1) {
            return List.of();
        }
        BigInteger step = MAX.divide(BigInteger.valueOf((long) size + 1));
        return java.util.stream.IntStream.rangeClosed(1, size)
                .mapToObj(index -> format(step.multiply(BigInteger.valueOf(index))))
                .toList();
    }

    private static BigInteger parse(String value) {
        if (value == null || value.length() != WIDTH || !value.chars().allMatch(Character::isDigit)) {
            throw new IllegalArgumentException("Catalog position is invalid");
        }
        return new BigInteger(value);
    }

    private static String format(BigInteger value) {
        String raw = value.toString();
        return "0".repeat(WIDTH - raw.length()) + raw;
    }
}
