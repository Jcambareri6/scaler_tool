import { geoContains } from "d3-geo";
import { feature } from "topojson-client";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import type { GeometryCollection, Topology } from "topojson-specification";
import countries50m from "world-atlas/countries-50m.json";

// Mapas (Fase 4): paises de Natural Earth 1:50m (world-atlas), sin red --
// mismo dato en el render y en el preview. El pais a resaltar sale de la
// coordenada (el que la contiene), asi el planificador no tiene que
// nombrarlo con un codigo.
export type Country = Feature<Geometry, { name: string }>;

let cache: Country[] | null = null;

export function countries(): Country[] {
  if (!cache) {
    const topo = countries50m as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>;
    cache = (feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>).features;
  }
  return cache;
}

export function countryAt(lon: number, lat: number): Country | null {
  return countries().find((c) => geoContains(c, [lon, lat])) ?? null;
}

export function validGeo(geo: { lat?: unknown; lon?: unknown } | undefined): geo is { lat: number; lon: number } {
  return (
    !!geo &&
    typeof geo.lat === "number" &&
    typeof geo.lon === "number" &&
    Math.abs(geo.lat) <= 90 &&
    Math.abs(geo.lon) <= 180
  );
}
