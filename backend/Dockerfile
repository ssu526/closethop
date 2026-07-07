FROM maven:3.9.11-eclipse-temurin-17 AS build
WORKDIR /workspace

COPY backend/pom.xml .
RUN mvn -q -DskipTests dependency:go-offline

COPY backend/src src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:17-jre
WORKDIR /app

RUN useradd --system --uid 10001 wardrobe
COPY --from=build /workspace/target/backend-0.0.1-SNAPSHOT.jar app.jar

USER wardrobe
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
