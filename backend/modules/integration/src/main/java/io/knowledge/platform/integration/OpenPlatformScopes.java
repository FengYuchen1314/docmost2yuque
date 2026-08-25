package io.knowledge.platform.integration;

import java.util.Arrays;import java.util.Locale;import java.util.Set;import java.util.stream.Collectors;

public final class OpenPlatformScopes {
    public static final Set<String> ALL=Set.of("workspaces:read","users:read","teams:read","knowledge-bases:read","documents:read","documents:write","catalog:read","search:read","webhooks:read","webhooks:write","offline_access");
    private OpenPlatformScopes(){}
    public static Set<String> normalize(Iterable<String> values){if(values==null)return Set.of();var result=new java.util.HashSet<String>();for(String value:values){if(value!=null&&!value.isBlank())result.add(value.trim().toLowerCase(Locale.ROOT));}if(!ALL.containsAll(result))throw new IllegalArgumentException("One or more scopes are invalid");return Set.copyOf(result);}
    public static Set<String> parse(String value){return normalize(value==null?Set.of():Arrays.asList(value.trim().split("\\s+")));}
    public static String join(Set<String> values){return values.stream().sorted().collect(Collectors.joining(" "));}
    public static void require(Set<String> scopes,String required){if(scopes==null||!scopes.contains(required))throw new OpenPlatformScopeException(required);}
}
