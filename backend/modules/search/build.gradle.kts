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
    api(project(":modules:common"))
    implementation(project(":modules:authorization"))
    implementation(project(":modules:workspace"))
    implementation(libs.spring.context)
    implementation(libs.spring.tx)
    implementation(libs.jooq)
    implementation(libs.jackson.databind)

    testImplementation(libs.spring.boot.test)
}
