plugins {
    java
    `java-library`
    alias(libs.plugins.spring.dependency.management)
}

dependencyManagement {
    imports {
        mavenBom(org.springframework.boot.gradle.plugin.SpringBootPlugin.BOM_COORDINATES)
    }
}

dependencies {
    api(libs.jackson.databind)
    implementation(libs.spring.context)
    testImplementation(libs.spring.boot.test)
}
