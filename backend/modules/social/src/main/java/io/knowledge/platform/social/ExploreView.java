package io.knowledge.platform.social;
import java.util.List;
public record ExploreView(List<PublicContentView> trending,List<PublicContentView> latest,List<PublicProfileView> creators,List<GardenView> gardens) {}
