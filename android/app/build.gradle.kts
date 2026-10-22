plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") version "2.0.21" }
val jazzRecoveryGeneratedRes = layout.buildDirectory.dir("generated/res/jazzRecovery")

val prepareJazzRecoveryIcon by tasks.registering(Copy::class) {
    from(rootProject.file("jazzrecovery.jpeg"))
    into(jazzRecoveryGeneratedRes.map { it.dir("drawable-nodpi") })
    rename { "jazzrecovery.jpg" }
}

android {
 namespace = "com.gunakarna.jazzrecovery"
 compileSdk = 35
 defaultConfig { applicationId = "com.gunakarna.jazzrecovery"; minSdk = 26; targetSdk = 35; versionCode = 1; versionName = "1.0.0" }
 sourceSets.getByName("main").res.srcDir(jazzRecoveryGeneratedRes)
 compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
}
kotlin { jvmToolchain(17) }

dependencies {
 implementation("androidx.work:work-runtime-ktx:2.10.1")
}

tasks.named("preBuild").configure { dependsOn(prepareJazzRecoveryIcon) }
