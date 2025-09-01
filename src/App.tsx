//@ts-nocheck

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import Map from "react-map-gl/mapbox";
import "mapbox-gl/dist/mapbox-gl.css";
import DeckGL from "@deck.gl/react";
import {
  ScatterplotLayer,
  PolygonLayer,
  PathLayer,
  IconLayer,
} from "@deck.gl/layers";
import { Icon } from "@iconify/react";
import { MapPin, Wifi, Circle, MapPin as Pin } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "./components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./components/ui/tooltip";
import * as turf from "@turf/turf";
import { useSocket } from "./hooks/useSocket";
import JSZip from "jszip";
import * as shapefile from "shapefile";
import * as mapboxgl from "mapbox-gl";

const INDIA_CENTER: [number, number] = [78.9629, 20.5937];

interface Layer {
  id: string;
  name: string;
  type:
    | "point"
    | "polygon"
    | "line"
    | "sector"
    | "distance"
    | "area"
    | "azimuth";
  data: any[];
  color: string;
  icon: string;
  visible: boolean;
  radius?: number; // For points
  measurement?: string; // For measurement layers
  isUploaded?: boolean; // Track if layer was uploaded from file
  pointDisplayMode?: "circle" | "icon"; // For point layers
  iconType?: "marker" | "pin" | "wifi" | "circle"; // Icon type for icon mode
  customizeOpen?: boolean; // Track if customize popover is open
  folder?: string; // Track which folder the layer belongs to
}

const App = () => {
  const [layers, setLayers] = useState<Layer[]>([]);
  const [drawMode, setDrawMode] = useState<
    | "none"
    | "point"
    | "polygon"
    | "line"
    | "sector"
    | "distance"
    | "area"
    | "azimuth"
  >("none");
  const [drawingPoints, setDrawingPoints] = useState<[number, number][]>([]);
  const [sectorCenter, setSectorCenter] = useState<[number, number] | null>(
    null
  );
  const [sectorRadius, setSectorRadius] = useState<number>(0);
  const [sectorStartAngle, setSectorStartAngle] = useState<number>(0);
  const [mousePosition, setMousePosition] = useState<[number, number] | null>(
    null
  );
  const [hoveredPoint, setHoveredPoint] = useState<[number, number] | null>(
    null
  );
  const [tooltipInfo, setTooltipInfo] = useState<{
    layer: Layer;
    coordinate: [number, number];
    x: number;
    y: number;
  } | null>(null);
  const [isRubberBandZooming, setIsRubberBandZooming] = useState(false);
  const [rubberBandStart, setRubberBandStart] = useState<
    [number, number] | null
  >(null);
  const [rubberBandEnd, setRubberBandEnd] = useState<[number, number] | null>(
    null
  );
  const [isDragging, setIsDragging] = useState(false);
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null);
  const [dragStartPosition, setDragStartPosition] = useState<
    [number, number] | null
  >(null);
  const [originalLayerData, setOriginalLayerData] = useState<any[] | null>(
    null
  );

  const [viewState, setViewState] = useState({
    longitude: INDIA_CENTER[0],
    latitude: INDIA_CENTER[1],
    zoom: 5,
    pitch: 0,
    bearing: 0,
  });

  // Map style state
  const [mapStyle, setMapStyle] = useState(
    "mapbox://styles/mapbox/satellite-v9"
  );

  // Performance settings
  const [terrainEnabled, setTerrainEnabled] = useState(true); // Enabled by default for 3D terrain
  const [performanceMode, setPerformanceMode] = useState(true); // Performance mode enabled by default

  const layerIdCounter = useRef(0);
  const deckRef = useRef<any>(null);
  const mapRef = useRef<any>(null);

  // Collapsible sections state
  const [collapsedSections, setCollapsedSections] = useState({
    untitled: false,
    drawn: false,
    uploaded: false,
    tools: false,
    network: false,
  });

  // Folder names state
  const [folderNames, setFolderNames] = useState({
    untitled: "Untitled",
    drawn: "Drawn",
    uploaded: "Uploaded",
    tools: "Tools",
  });

  // Custom folders state
  const [customFolders, setCustomFolders] = useState<string[]>([]);

  // Folder editing state
  const [editingFolder, setEditingFolder] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  // New folder creation state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // Sidebar collapse state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Socket connection
  const { data: socketData, isConnected } = useSocket("ws://localhost:8080");

  // Network nodes layer state
  const [networkLayerState, setNetworkLayerState] = useState({
    visible: true,
    radius: 15,
    pointDisplayMode: "icon" as "circle" | "icon",
    iconType: "marker" as "marker" | "pin" | "wifi" | "circle",
  });

  // Create network nodes layer from socket data
  const networkNodesLayer: Layer | null = useMemo(() => {
    if (socketData && Array.isArray(socketData) && socketData.length > 0) {
      return {
        id: "network-nodes",
        name: "Network Nodes",
        type: "point",
        data: socketData.map((node: any) => ({
          position: [node.longitude, node.latitude],
          node: node, // Store the original node data for SNR-based coloring
        })),
        color: "#00ff00", // This won't be used for SNR-based coloring
        icon: "mdi:map-marker",
        visible: networkLayerState.visible,
        radius: networkLayerState.radius,
        pointDisplayMode: networkLayerState.pointDisplayMode,
        iconType: networkLayerState.iconType,
        isUploaded: false,
      };
    }
    return null;
  }, [socketData, networkLayerState]);

  // Save preferences to localStorage
  const savePreferences = () => {
    const preferences = {
      viewState,
      layers,
      folderNames,
      collapsedSections,
      mapStyle,
      timestamp: new Date().toISOString(),
    };
    localStorage.setItem("mapPreferences", JSON.stringify(preferences));
  };

  // Load preferences from localStorage
  const loadPreferences = () => {
    const saved = localStorage.getItem("mapPreferences");
    if (saved) {
      try {
        const preferences = JSON.parse(saved);
        if (preferences.viewState) {
          setViewState(preferences.viewState);
        }
        if (preferences.layers) {
          setLayers(preferences.layers);
        }
        if (preferences.folderNames) {
          setFolderNames(preferences.folderNames);
        }
        if (preferences.collapsedSections) {
          setCollapsedSections(preferences.collapsedSections);
        }
        if (preferences.mapStyle) {
          setMapStyle(preferences.mapStyle);
        }
      } catch (error) {
        console.error("Error loading preferences:", error);
      }
    }
  };

  // Download all data as JSON file
  const downloadData = () => {
    const data = {
      viewState,
      layers,
      folderNames,
      collapsedSections,
      mapStyle,
      networkLayerState,
      timestamp: new Date().toISOString(),
    };

    const dataStr = JSON.stringify(data, null, 2);
    const dataBlob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(dataBlob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `map-data-${new Date().toISOString().split("T")[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Upload and load data from JSON file
  const uploadData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target?.result as string);

        if (data.viewState) {
          setViewState(data.viewState);
        }
        if (data.layers) {
          setLayers(data.layers);
        }
        if (data.folderNames) {
          setFolderNames(data.folderNames);
        }
        if (data.collapsedSections) {
          setCollapsedSections(data.collapsedSections);
        }
        if (data.mapStyle) {
          setMapStyle(data.mapStyle);
        }
        if (data.networkLayerState) {
          setNetworkLayerState(data.networkLayerState);
        }

        alert("Data loaded successfully!");
      } catch (error) {
        console.error("Error loading data:", error);
        alert("Error loading data. Please check the file format.");
      }
    };
    reader.readAsText(file);

    // Reset the input
    event.target.value = "";
  };

  // Start fresh - reset everything to new session
  const startFresh = () => {
    if (
      confirm(
        "Are you sure you want to start fresh? This will remove all layers, reset all settings, and clear localStorage. This action cannot be undone."
      )
    ) {
      // Reset all state to defaults
      setLayers([]);
      setViewState({
        longitude: INDIA_CENTER[0],
        latitude: INDIA_CENTER[1],
        zoom: 5,
        pitch: 0,
        bearing: 0,
      });
      setMapStyle("mapbox://styles/mapbox/satellite-v9");
      setFolderNames({
        untitled: "Untitled",
        drawn: "Drawn",
        uploaded: "Uploaded",
        tools: "Tools",
      });
      setCollapsedSections({
        untitled: false,
        drawn: false,
        uploaded: false,
        tools: false,
        network: false,
      });
      setNetworkLayerState({
        visible: true,
        radius: 15,
        pointDisplayMode: "icon" as "circle" | "icon",
        iconType: "marker" as "marker" | "pin" | "wifi" | "circle",
      });

      // Clear custom folders
      setCustomFolders([]);
      setIsCreatingFolder(false);
      setNewFolderName("");

      // Clear localStorage
      localStorage.removeItem("mapPreferences");

      // Reset drawing states
      setDrawMode("none");
      setDrawingPoints([]);
      setSectorCenter(null);
      setSectorRadius(0);
      setSectorStartAngle(0);
      setMousePosition(null);
      setHoveredPoint(null);
      setTooltipInfo(null);

      alert("Fresh session started! All data has been cleared.");
    }
  };

  // Generate unique layer ID
  const generateLayerId = () =>
    `layer-${layerIdCounter.current++}-${Date.now()}`;

  // Handle folder name editing
  const startEditingFolder = (folderKey: string) => {
    setEditingFolder(folderKey);
    setEditingValue(folderNames[folderKey as keyof typeof folderNames]);
  };

  const saveFolderName = (folderKey: string) => {
    if (editingValue.trim()) {
      setFolderNames((prev) => ({
        ...prev,
        [folderKey]: editingValue.trim(),
      }));
    }
    setEditingFolder(null);
    setEditingValue("");
  };

  const cancelEditingFolder = () => {
    setEditingFolder(null);
    setEditingValue("");
  };

  // Add new custom folder
  const addCustomFolder = () => {
    if (newFolderName.trim()) {
      setCustomFolders((prev) => [...prev, newFolderName.trim()]);
      setNewFolderName("");
      setIsCreatingFolder(false);
    }
  };

  // Remove custom folder
  const removeCustomFolder = (folderName: string) => {
    setCustomFolders((prev) => prev.filter((f) => f !== folderName));
    // Move layers from this folder to "Untitled"
    setLayers((prev) =>
      prev.map((layer) =>
        layer.folder === folderName ? { ...layer, folder: "untitled" } : layer
      )
    );
  };

  // Move layer to different folder
  const moveLayerToFolder = (layerId: string, folderName: string) => {
    setLayers((prev) =>
      prev.map((layer) =>
        layer.id === layerId ? { ...layer, folder: folderName } : layer
      )
    );
  };

  // Load preferences on component mount
  useEffect(() => {
    loadPreferences();
  }, []);

  // Handle terrain changes
  useEffect(() => {
    if (mapRef.current) {
      toggleTerrain();
    }
  }, [terrainEnabled]);

  // Save layers to localStorage whenever layers change (debounced)
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (layers.length > 0) {
        const preferences = {
          viewState,
          layers,
          folderNames,
          collapsedSections,
          mapStyle,
          timestamp: new Date().toISOString(),
        };
        localStorage.setItem("mapPreferences", JSON.stringify(preferences));
      }
    }, 1000); // Debounce to 1 second

    return () => clearTimeout(timeoutId);
  }, [layers, folderNames, collapsedSections, mapStyle]); // Removed viewState dependency to reduce unnecessary saves

  // Handle map clicks for drawing only
  const handleMapClick = useCallback(
    (info: any) => {
      // Only handle drawing, tooltips are handled by hover
      if (drawMode === "none") {
        return;
      }

      const coordinate: [number, number] = [
        info.coordinate[0],
        info.coordinate[1],
      ];

      if (drawMode === "point") {
        // Add single point
        const newLayer: Layer = {
          id: generateLayerId(),
          name: `Point ${layers.length + 1}`,
          type: "point",
          data: [{ position: coordinate }],
          color: "#ff0000",
          icon: "mdi:map-marker",
          visible: true,
          radius: 12,
          pointDisplayMode: "circle",
          iconType: "marker",
          folder: "drawn",
        };
        setLayers((prev) => [...prev, newLayer]);
        setDrawMode("none");
      } else if (drawMode === "polygon") {
        // Add point to polygon drawing
        const newPoints = [...drawingPoints, coordinate];

        // Check if we clicked on the first point (within a reasonable tolerance)
        if (drawingPoints.length >= 2) {
          const firstPoint = drawingPoints[0];

          // Calculate distance in degrees
          const distanceInDegrees = Math.sqrt(
            Math.pow(coordinate[0] - firstPoint[0], 2) +
              Math.pow(coordinate[1] - firstPoint[1], 2)
          );

          // Convert to a more user-friendly tolerance based on zoom level
          // At higher zoom levels, we want smaller tolerance, at lower zoom levels, larger tolerance
          const zoomFactor = Math.max(0.1, 1 / Math.pow(2, viewState.zoom - 5));
          const tolerance = 0.05 * zoomFactor; // Much more generous tolerance for easier clicking

          // If we're close to the first point, close the polygon
          if (distanceInDegrees < tolerance) {
            console.log(
              `Closing polygon: distance=${distanceInDegrees.toFixed(
                6
              )}, tolerance=${tolerance.toFixed(6)}`
            );
            const closedPoints = [...newPoints, newPoints[0]];
            const newLayer: Layer = {
              id: generateLayerId(),
              name: `Polygon ${layers.length + 1}`,
              type: "polygon",
              data: [{ polygon: closedPoints }],
              color: "#00ff00",
              icon: "mdi:vector-square",
              visible: true,
              folder: "drawn",
            };
            setLayers((prev) => [...prev, newLayer]);
            setDrawingPoints([]);
            setDrawMode("none");
            return;
          }
        }

        setDrawingPoints(newPoints);
      } else if (drawMode === "line") {
        // Line drawing: two points
        const newPoints = [...drawingPoints, coordinate];

        if (newPoints.length === 2) {
          // Create line
          const newLayer: Layer = {
            id: generateLayerId(),
            name: `Line ${layers.length + 1}`,
            type: "line",
            data: [{ path: newPoints }],
            color: "#ff0000",
            icon: "mdi:vector-line",
            visible: true,
            folder: "drawn",
          };

          setLayers((prev) => [...prev, newLayer]);
          setDrawingPoints([]);
          setDrawMode("none");
        } else {
          setDrawingPoints(newPoints);
        }
      } else if (drawMode === "sector") {
        if (!sectorCenter) {
          // First click: set the center
          setSectorCenter(coordinate);
        } else if (sectorRadius === 0) {
          // Second click: set the radius
          const radius = Math.sqrt(
            Math.pow(coordinate[0] - sectorCenter[0], 2) +
              Math.pow(coordinate[1] - sectorCenter[1], 2)
          );
          setSectorRadius(radius);
          // Don't set start angle here - let the user choose it with the third click
        } else if (sectorStartAngle === 0) {
          // Third click: set the start angle
          const startAngle = Math.atan2(
            coordinate[1] - sectorCenter[1],
            coordinate[0] - sectorCenter[0]
          );
          setSectorStartAngle(startAngle);
        } else {
          // Fourth click: set the end angle and create sector
          const endAngle = Math.atan2(
            coordinate[1] - sectorCenter[1],
            coordinate[0] - sectorCenter[0]
          );

          // Create sector polygon
          const sectorPolygon = createSectorPolygon(
            sectorCenter,
            sectorRadius,
            sectorStartAngle,
            endAngle
          );

          const newLayer: Layer = {
            id: generateLayerId(),
            name: `Sector ${layers.length + 1}`,
            type: "sector",
            data: [{ polygon: sectorPolygon }],
            color: "#ff8800",
            icon: "mdi:pie-chart",
            visible: true,
            measurement: `${Math.abs(
              ((endAngle - sectorStartAngle) * 180) / Math.PI
            ).toFixed(1)}°`,
          };

          setLayers((prev) => [...prev, newLayer]);
          setSectorCenter(null);
          setSectorRadius(0);
          setSectorStartAngle(0);
          setDrawMode("none");
        }
      } else if (drawMode === "distance") {
        // Distance measurement: two points
        const newPoints = [...drawingPoints, coordinate];

        if (newPoints.length === 2) {
          // Calculate distance
          const distance = calculateDistance(newPoints[0], newPoints[1]);

          const newLayer: Layer = {
            id: generateLayerId(),
            name: `Distance ${layers.length + 1}`,
            type: "distance",
            data: [{ path: newPoints }],
            color: "#0000ff",
            icon: "mdi:ruler",
            visible: true,
            measurement: `${distance.toFixed(2)} km`,
          };

          setLayers((prev) => [...prev, newLayer]);
          setDrawingPoints([]);
          setDrawMode("none");
        } else {
          setDrawingPoints(newPoints);
        }
      } else if (drawMode === "area") {
        // Area measurement: polygon
        const newPoints = [...drawingPoints, coordinate];

        // Check if we clicked on the first point (within a small tolerance)
        if (drawingPoints.length >= 2) {
          const firstPoint = drawingPoints[0];
          const distance = Math.sqrt(
            Math.pow(coordinate[0] - firstPoint[0], 2) +
              Math.pow(coordinate[1] - firstPoint[1], 2)
          );

          // Use the same tolerance logic as polygon drawing
          const zoomFactor = Math.max(0.1, 1 / Math.pow(2, viewState.zoom - 5));
          const tolerance = 0.05 * zoomFactor;

          // If we're close to the first point, close the polygon and calculate area
          if (distance < tolerance) {
            const closedPoints = [...newPoints, newPoints[0]];
            const area = calculatePolygonArea(closedPoints);

            const newLayer: Layer = {
              id: generateLayerId(),
              name: `Area ${layers.length + 1}`,
              type: "area",
              data: [{ polygon: closedPoints }],
              color: "#00ffff",
              icon: "mdi:vector-square",
              visible: true,
              measurement: `${area.toFixed(2)} km²`,
            };

            setLayers((prev) => [...prev, newLayer]);
            setDrawingPoints([]);
            setDrawMode("none");
            return;
          }
        }

        setDrawingPoints(newPoints);
      } else if (drawMode === "azimuth") {
        // Azimuth measurement: two points
        const newPoints = [...drawingPoints, coordinate];

        if (newPoints.length === 2) {
          // Calculate azimuth
          const azimuth = calculateAzimuth(newPoints[0], newPoints[1]);

          const newLayer: Layer = {
            id: generateLayerId(),
            name: `Azimuth ${layers.length + 1}`,
            type: "azimuth",
            data: [{ path: newPoints }],
            color: "#ff00ff",
            icon: "mdi:compass",
            visible: true,
            measurement: `${azimuth.toFixed(1)}°`,
          };

          setLayers((prev) => [...prev, newLayer]);
          setDrawingPoints([]);
          setDrawMode("none");
        } else {
          setDrawingPoints(newPoints);
        }
      }
    },
    [
      drawMode,
      layers.length,
      drawingPoints,
      sectorCenter,
      sectorRadius,
      sectorStartAngle,
      layers,
      networkNodesLayer,
      socketData,
    ]
  );

  // Remove layer
  const removeLayer = (layerId: string) => {
    setLayers((prev) => prev.filter((layer) => layer.id !== layerId));
  };

  // Toggle layer visibility
  const toggleLayerVisibility = (layerId: string) => {
    setLayers((prev) =>
      prev.map((layer) =>
        layer.id === layerId ? { ...layer, visible: !layer.visible } : layer
      )
    );
  };

  // Focus on layer
  const focusOnLayer = (layerId: string) => {
    const layer = layers.find((l) => l.id === layerId);
    if (!layer) return;

    // Calculate bounding box for all objects in the layer
    let minLng = Infinity;
    let maxLng = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;

    layer.data.forEach((item: any) => {
      if (layer.type === "point") {
        const [lng, lat] = item.position;
        minLng = Math.min(minLng, lng);
        maxLng = Math.max(maxLng, lng);
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
      } else if (
        layer.type === "polygon" ||
        layer.type === "area" ||
        layer.type === "sector"
      ) {
        item.polygon.forEach((point: [number, number]) => {
          const [lng, lat] = point;
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
        });
      } else if (
        layer.type === "line" ||
        layer.type === "distance" ||
        layer.type === "azimuth"
      ) {
        item.path.forEach((point: [number, number]) => {
          const [lng, lat] = point;
          minLng = Math.min(minLng, lng);
          maxLng = Math.max(maxLng, lng);
          minLat = Math.min(minLat, lat);
          maxLat = Math.max(maxLat, lat);
        });
      }
    });

    // Calculate center of bounding box
    const centerLng = (minLng + maxLng) / 2;
    const centerLat = (minLat + maxLat) / 2;

    // Calculate appropriate zoom level based on the size of the bounding box
    const lngDiff = maxLng - minLng;
    const latDiff = maxLat - minLat;
    const maxDiff = Math.max(lngDiff, latDiff);

    // Calculate zoom level to ensure all objects are clearly visible
    // Use a more conservative approach to ensure every point is visible
    let zoom;
    if (layer.data.length === 1 && layer.type === "point") {
      // Single point - use high zoom
      zoom = layer.isUploaded ? 15 : 17;
    } else if (maxDiff < 0.001) {
      // Very small area - very high zoom
      zoom = layer.isUploaded ? 16 : 18;
    } else if (maxDiff < 0.01) {
      // Small area - high zoom
      zoom = layer.isUploaded ? 15 : 17;
    } else if (maxDiff < 0.1) {
      // Medium-small area - medium-high zoom
      zoom = layer.isUploaded ? 13 : 15;
    } else if (maxDiff < 0.5) {
      // Medium area - medium zoom
      zoom = layer.isUploaded ? 11 : 13;
    } else if (maxDiff < 2) {
      // Large area - medium-low zoom
      zoom = layer.isUploaded ? 9 : 11;
    } else if (maxDiff < 10) {
      // Very large area - low zoom
      zoom = layer.isUploaded ? 7 : 9;
    } else {
      // Extremely large area - very low zoom
      zoom = layer.isUploaded ? 5 : 7;
    }

    // Add more padding to ensure all objects are clearly visible
    // For point layers, be extra conservative to ensure each point is distinct
    if (layer.type === "point" && layer.data.length > 1) {
      zoom = Math.max(1, Math.min(20, zoom - 2));
    } else {
      zoom = Math.max(1, Math.min(20, zoom - 1));
    }

    setViewState({
      longitude: centerLng,
      latitude: centerLat,
      zoom,
      pitch: 0,
      bearing: 0,
    });
  };

  // Change layer color
  const changeLayerColor = (layerId: string, color: string) => {
    setLayers((prev) =>
      prev.map((layer) => {
        if (layer.id === layerId) {
          // Update the color without changing the ID
          return {
            ...layer,
            color,
          };
        }
        return layer;
      })
    );
  };

  // Change layer icon
  const changeLayerIcon = (layerId: string, icon: string) => {
    setLayers((prev) =>
      prev.map((layer) => (layer.id === layerId ? { ...layer, icon } : layer))
    );
  };

  // Change layer radius (for points)
  const changeLayerRadius = (layerId: string, radius: number) => {
    setLayers((prev) =>
      prev.map((layer) => {
        if (layer.id === layerId) {
          // Update the radius without changing the ID
          return {
            ...layer,
            radius,
          };
        }
        return layer;
      })
    );
  };

  // Change point display mode (for points)
  const changePointDisplayMode = (layerId: string, mode: "circle" | "icon") => {
    setLayers((prev) =>
      prev.map((layer) => {
        if (layer.id === layerId) {
          return {
            ...layer,
            pointDisplayMode: mode,
          };
        }
        return layer;
      })
    );
  };

  // Change icon type (for points in icon mode)
  const changeIconType = (
    layerId: string,
    iconType: "marker" | "pin" | "star" | "circle"
  ) => {
    setLayers((prev) =>
      prev.map((layer) => {
        if (layer.id === layerId) {
          return {
            ...layer,
            iconType: iconType,
          };
        }
        return layer;
      })
    );
  };

  // Change layer name
  const changeLayerName = (layerId: string, name: string) => {
    setLayers((prev) =>
      prev.map((layer) => (layer.id === layerId ? { ...layer, name } : layer))
    );
  };

  // Toggle terrain function
  const toggleTerrain = (enabled: boolean) => {
    if (!mapRef.current) return;

    const map = mapRef.current;

    if (enabled) {
      // Enable terrain
      map.setTerrain({
        source: "mapbox-dem",
        exaggeration: 1.0,
      });

      // Add hillshading if not already present
      if (!map.getLayer("hillshading")) {
        map.addLayer({
          id: "hillshading",
          source: "mapbox-dem",
          type: "hillshade",
          paint: {
            "hillshade-shadow-color": "#000000",
            "hillshade-highlight-color": "#FFFFFF",
            "hillshade-accent-color": "#000000",
          },
        });
      }
    } else {
      // Disable terrain
      map.setTerrain(null);

      // Remove hillshading
      if (map.getLayer("hillshading")) {
        map.removeLayer("hillshading");
      }
    }
  };

  // Set layer customize popover open state
  const setLayerCustomizeOpen = (layerId: string, open: boolean) => {
    setLayers((prev) =>
      prev.map((layer) =>
        layer.id === layerId ? { ...layer, customizeOpen: open } : layer
      )
    );
  };

  // Change layer stroke width

  // Zoom functions
  const zoomIn = () => {
    setViewState((prev) => ({
      ...prev,
      zoom: Math.min(20, prev.zoom + 1),
    }));
  };

  const zoomOut = () => {
    setViewState((prev) => ({
      ...prev,
      zoom: Math.max(1, prev.zoom - 1),
    }));
  };

  const resetView = () => {
    setViewState({
      longitude: INDIA_CENTER[0],
      latitude: INDIA_CENTER[1],
      zoom: 5,
      pitch: 0,
      bearing: 0,
    });
  };

  // File upload functions
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.name.toLowerCase().endsWith(".zip")) {
      handleZIPUpload(file);
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;

        if (file.name.toLowerCase().endsWith(".csv")) {
          handleCSVUpload(content);
        } else if (
          file.name.toLowerCase().endsWith(".geojson") ||
          file.name.toLowerCase().endsWith(".json")
        ) {
          handleGeoJSONUpload(content);
        }
      };
      reader.readAsText(file);
    }

    // Reset the input
    event.target.value = "";
  };

  const handleCSVUpload = (content: string) => {
    const lines = content.split("\n");
    const headers = lines[0].split(",").map((h) => h.trim());

    // Find latitude and longitude columns
    const latIndex = headers.findIndex(
      (h) =>
        h.toLowerCase().includes("lat") || h.toLowerCase().includes("latitude")
    );
    const lngIndex = headers.findIndex(
      (h) =>
        h.toLowerCase().includes("lng") ||
        h.toLowerCase().includes("long") ||
        h.toLowerCase().includes("longitude")
    );

    if (latIndex === -1 || lngIndex === -1) {
      alert("Could not find latitude and longitude columns in CSV");
      return;
    }

    const points: any[] = [];
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const values = line.split(",").map((v) => v.trim());
      const lat = parseFloat(values[latIndex]);
      const lng = parseFloat(values[lngIndex]);

      if (!isNaN(lat) && !isNaN(lng)) {
        points.push({ position: [lng, lat] });
      }
    }

    if (points.length > 0) {
      const newLayer: Layer = {
        id: generateLayerId(),
        name: `CSV Points ${layers.length + 1}`,
        type: "point",
        data: points,
        color: "#ff0000",
        icon: "mdi:map-marker",
        visible: true,
        radius: 12,
        pointDisplayMode: "circle",
        iconType: "marker",
        isUploaded: true,
        folder: "uploaded",
      };
      setLayers((prev) => [...prev, newLayer]);
    }
  };

  const handleGeoJSONUpload = (content: string) => {
    try {
      const geojson = JSON.parse(content);

      if (!geojson.features || !Array.isArray(geojson.features)) {
        alert("Invalid GeoJSON format");
        return;
      }

      const points: any[] = [];
      const polygons: any[] = [];
      const lines: any[] = [];

      geojson.features.forEach((feature: any) => {
        if (feature.geometry.type === "Point") {
          points.push({ position: feature.geometry.coordinates });
        } else if (feature.geometry.type === "Polygon") {
          // Convert to our polygon format
          const coordinates = feature.geometry.coordinates[0]; // First ring
          const polygon = coordinates.map((coord: number[]) => [
            coord[0],
            coord[1],
          ]);
          polygons.push({ polygon });
        } else if (feature.geometry.type === "LineString") {
          const coordinates = feature.geometry.coordinates.map(
            (coord: number[]) => [coord[0], coord[1]]
          );
          lines.push({ path: coordinates });
        }
      });

      // Create layers based on geometry types found
      if (points.length > 0) {
        const newLayer: Layer = {
          id: generateLayerId(),
          name: `GeoJSON Points ${layers.length + 1}`,
          type: "point",
          data: points,
          color: "#ff0000",
          icon: "mdi:map-marker",
          visible: true,
          radius: 12,
          pointDisplayMode: "circle",
          iconType: "marker",
          isUploaded: true,
          folder: "uploaded",
        };
        setLayers((prev) => [...prev, newLayer]);
      }

      if (polygons.length > 0) {
        const newLayer: Layer = {
          id: generateLayerId(),
          name: `GeoJSON Polygons ${layers.length + 1}`,
          type: "polygon",
          data: polygons,
          color: "#00ff00",
          icon: "mdi:vector-polygon",
          visible: true,
          isUploaded: true,
          folder: "uploaded",
        };
        setLayers((prev) => [...prev, newLayer]);
      }

      if (lines.length > 0) {
        const newLayer: Layer = {
          id: generateLayerId(),
          name: `GeoJSON Lines ${layers.length + 1}`,
          type: "line",
          data: lines,
          color: "#0000ff",
          icon: "mdi:vector-line",
          visible: true,
          isUploaded: true,
          folder: "uploaded",
        };
        setLayers((prev) => [...prev, newLayer]);
      }
    } catch (error) {
      alert("Error parsing GeoJSON file");
      console.error(error);
    }
  };

  const handleZIPUpload = async (file: File) => {
    try {
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(file);

      // Find shapefile files in the ZIP
      const shpFiles = Object.keys(zipContent.files).filter((name) =>
        name.toLowerCase().endsWith(".shp")
      );

      // Find GeoJSON files in the ZIP
      const geojsonFiles = Object.keys(zipContent.files).filter(
        (name) =>
          name.toLowerCase().endsWith(".geojson") ||
          name.toLowerCase().endsWith(".json")
      );

      if (shpFiles.length === 0 && geojsonFiles.length === 0) {
        alert(
          "No shapefile (.shp) or GeoJSON (.geojson/.json) found in the ZIP file"
        );
        return;
      }

      let processedFiles = 0;

      // Process each shapefile
      for (const shpFileName of shpFiles) {
        const baseName = shpFileName.replace(".shp", "");
        const shpFile = zipContent.files[shpFileName];
        const dbfFile = zipContent.files[baseName + ".dbf"];

        if (!shpFile) {
          console.warn(`Shapefile ${shpFileName} not found in ZIP`);
          continue;
        }

        // Read the shapefile data
        const shpBuffer = await shpFile.async("arraybuffer");
        const dbfBuffer = dbfFile ? await dbfFile.async("arraybuffer") : null;

        // Parse the shapefile
        const source = shapefile.open(shpBuffer, dbfBuffer);
        const points: any[] = [];
        const polygons: any[] = [];
        const lines: any[] = [];

        let result;
        while ((result = await source.read()) && !result.done) {
          const feature = result.value;

          if (feature.geometry) {
            if (feature.geometry.type === "Point") {
              points.push({
                position: feature.geometry.coordinates,
                properties: feature.properties || {},
              });
            } else if (feature.geometry.type === "Polygon") {
              // Convert to our polygon format
              const coordinates = feature.geometry.coordinates[0]; // First ring
              const polygon = coordinates.map((coord: number[]) => [
                coord[0],
                coord[1],
              ]);
              polygons.push({
                polygon,
                properties: feature.properties || {},
              });
            } else if (feature.geometry.type === "LineString") {
              const coordinates = feature.geometry.coordinates.map(
                (coord: number[]) => [coord[0], coord[1]]
              );
              lines.push({
                path: coordinates,
                properties: feature.properties || {},
              });
            }
          }
        }

        // Create layers based on geometry types found
        const layerName = baseName.split("/").pop() || baseName; // Get filename without path

        if (points.length > 0) {
          const newLayer: Layer = {
            id: generateLayerId(),
            name: `${layerName} Points`,
            type: "point",
            data: points,
            color: "#ff0000",
            icon: "mdi:map-marker",
            visible: true,
            radius: 12,
            pointDisplayMode: "circle",
            iconType: "marker",
            isUploaded: true,
            folder: "uploaded",
          };
          setLayers((prev) => [...prev, newLayer]);
        }

        if (polygons.length > 0) {
          const newLayer: Layer = {
            id: generateLayerId(),
            name: `${layerName} Polygons`,
            type: "polygon",
            data: polygons,
            color: "#00ff00",
            icon: "mdi:vector-polygon",
            visible: true,
            isUploaded: true,
            folder: "uploaded",
          };
          setLayers((prev) => [...prev, newLayer]);
        }

        if (lines.length > 0) {
          const newLayer: Layer = {
            id: generateLayerId(),
            name: `${layerName} Lines`,
            type: "line",
            data: lines,
            color: "#0000ff",
            icon: "mdi:vector-line",
            visible: true,
            isUploaded: true,
            folder: "uploaded",
          };
          setLayers((prev) => [...prev, newLayer]);
        }

        processedFiles++;
      }

      // Process each GeoJSON file
      for (const geojsonFileName of geojsonFiles) {
        const geojsonFile = zipContent.files[geojsonFileName];

        if (!geojsonFile) {
          console.warn(`GeoJSON file ${geojsonFileName} not found in ZIP`);
          continue;
        }

        // Read the GeoJSON content
        const geojsonContent = await geojsonFile.async("string");

        try {
          const geojson = JSON.parse(geojsonContent);

          if (!geojson.features || !Array.isArray(geojson.features)) {
            console.warn(`Invalid GeoJSON format in ${geojsonFileName}`);
            continue;
          }

          const points: any[] = [];
          const polygons: any[] = [];
          const lines: any[] = [];

          geojson.features.forEach((feature: any) => {
            if (feature.geometry.type === "Point") {
              points.push({
                position: feature.geometry.coordinates,
                properties: feature.properties || {},
              });
            } else if (feature.geometry.type === "Polygon") {
              // Convert to our polygon format
              const coordinates = feature.geometry.coordinates[0]; // First ring
              const polygon = coordinates.map((coord: number[]) => [
                coord[0],
                coord[1],
              ]);
              polygons.push({
                polygon,
                properties: feature.properties || {},
              });
            } else if (feature.geometry.type === "LineString") {
              const coordinates = feature.geometry.coordinates.map(
                (coord: number[]) => [coord[0], coord[1]]
              );
              lines.push({
                path: coordinates,
                properties: feature.properties || {},
              });
            }
          });

          // Create layers based on geometry types found
          const layerName =
            geojsonFileName
              .split("/")
              .pop()
              ?.replace(/\.(geojson|json)$/i, "") || geojsonFileName;

          if (points.length > 0) {
            const newLayer: Layer = {
              id: generateLayerId(),
              name: `${layerName} Points`,
              type: "point",
              data: points,
              color: "#ff0000",
              icon: "mdi:map-marker",
              visible: true,
              radius: 12,
              pointDisplayMode: "circle",
              iconType: "marker",
              isUploaded: true,
              folder: "uploaded",
            };
            setLayers((prev) => [...prev, newLayer]);
          }

          if (polygons.length > 0) {
            const newLayer: Layer = {
              id: generateLayerId(),
              name: `${layerName} Polygons`,
              type: "polygon",
              data: polygons,
              color: "#00ff00",
              icon: "mdi:vector-polygon",
              visible: true,
              isUploaded: true,
              folder: "uploaded",
            };
            setLayers((prev) => [...prev, newLayer]);
          }

          if (lines.length > 0) {
            const newLayer: Layer = {
              id: generateLayerId(),
              name: `${layerName} Lines`,
              type: "line",
              data: lines,
              color: "#0000ff",
              icon: "mdi:vector-line",
              visible: true,
              isUploaded: true,
              folder: "uploaded",
            };
            setLayers((prev) => [...prev, newLayer]);
          }

          processedFiles++;
        } catch (parseError) {
          console.error(
            `Error parsing GeoJSON file ${geojsonFileName}:`,
            parseError
          );
        }
      }

      const totalFiles = shpFiles.length + geojsonFiles.length;
      alert(
        `Successfully processed ${processedFiles} file(s) from ZIP (${shpFiles.length} shapefile(s), ${geojsonFiles.length} GeoJSON file(s))`
      );
    } catch (error) {
      console.error("Error processing ZIP file:", error);
      alert(
        "Error processing ZIP file. Please check if it contains valid shapefiles or GeoJSON files."
      );
    }
  };

  // Handle mouse movement for drawing preview and tooltips
  const handleMouseMove = useCallback(
    (info: any) => {
      // Handle tooltip for existing layers when not in drawing mode
      if (drawMode === "none" && info.object && info.layer && info.coordinate) {
        const layerId = info.layer.id;

        // Handle network nodes tooltip
        if (
          (layerId === "network-nodes" || layerId === "network-nodes-icon") &&
          info.object
        ) {
          // Find the corresponding socket data for this node
          const nodeIndex = networkNodesLayer?.data.findIndex(
            (item: any) =>
              item.position[0] === info.coordinate[0] &&
              item.position[1] === info.coordinate[1]
          );

          if (
            nodeIndex !== undefined &&
            nodeIndex >= 0 &&
            Array.isArray(socketData) &&
            socketData[nodeIndex]
          ) {
            const node = socketData[nodeIndex];
            setTooltipInfo({
              layer: {
                id: "network-nodes",
                name: `Node ${node.userId}`,
                type: "point" as any,
                data: [node],
                color: networkNodesLayer?.color || "#00ff00",
                icon: "",
                visible: true,
              },
              coordinate: [info.coordinate[0], info.coordinate[1]],
              x: info.x,
              y: info.y,
            });
          }
        } else {
          // Handle regular layers - find layer by matching the base ID
          const layer = layers.find((l) => layerId.startsWith(l.id));
          if (layer) {
            setTooltipInfo({
              layer,
              coordinate: [info.coordinate[0], info.coordinate[1]],
              x: info.x,
              y: info.y,
            });
          }
        }
      } else if (drawMode === "none" && !info.object) {
        // Clear tooltip when not hovering over any object
        setTooltipInfo(null);
      }

      // Handle drawing preview
      if (drawMode !== "none" && info.coordinate) {
        setMousePosition([info.coordinate[0], info.coordinate[1]]);

        // Check if hovering over the first point during polygon/area drawing
        if (
          (drawMode === "polygon" || drawMode === "area") &&
          drawingPoints.length >= 2
        ) {
          const firstPoint = drawingPoints[0];
          const distanceInDegrees = Math.sqrt(
            Math.pow(info.coordinate[0] - firstPoint[0], 2) +
              Math.pow(info.coordinate[1] - firstPoint[1], 2)
          );

          // Use the same tolerance logic as the click handler
          const zoomFactor = Math.max(0.1, 1 / Math.pow(2, viewState.zoom - 5));
          const tolerance = 0.05 * zoomFactor;

          if (distanceInDegrees < tolerance) {
            setHoveredPoint(firstPoint);
          } else {
            setHoveredPoint(null);
          }
        } else {
          setHoveredPoint(null);
        }
      } else if (drawMode !== "none" && !info.coordinate) {
        setMousePosition(null);
        setHoveredPoint(null);
      }

      // Handle rubber band zoom
      if (isRubberBandZooming && info.coordinate) {
        setRubberBandEnd([info.coordinate[0], info.coordinate[1]]);
      }
    },
    [
      drawMode,
      drawingPoints,
      isRubberBandZooming,
      viewState.zoom,
      layers,
      networkNodesLayer,
      socketData,
    ]
  );

  // Handle mouse leave to clear preview
  const handleMouseLeave = useCallback(() => {
    setMousePosition(null);
  }, []);

  // Handle rubber band zoom start
  const handleRubberBandStart = useCallback(
    (info: any) => {
      // Only start rubber band zoom if we're not in drawing mode and have coordinates
      if (drawMode === "none" && info.coordinate) {
        setIsRubberBandZooming(true);
        setRubberBandStart([info.coordinate[0], info.coordinate[1]]);
        setRubberBandEnd([info.coordinate[0], info.coordinate[1]]);
      }
    },
    [drawMode]
  );

  // Handle rubber band zoom end
  const handleRubberBandEnd = useCallback(
    (info: any) => {
      if (isRubberBandZooming && rubberBandStart && rubberBandEnd) {
        // Calculate the bounding box
        const minLng = Math.min(rubberBandStart[0], rubberBandEnd[0]);
        const maxLng = Math.max(rubberBandStart[0], rubberBandEnd[0]);
        const minLat = Math.min(rubberBandStart[1], rubberBandEnd[1]);
        const maxLat = Math.max(rubberBandStart[1], rubberBandEnd[1]);

        // Calculate center and zoom
        const centerLng = (minLng + maxLng) / 2;
        const centerLat = (minLat + maxLat) / 2;

        // Calculate appropriate zoom level based on the size of the selection
        const lngDiff = maxLng - minLng;
        const latDiff = maxLat - minLat;
        const maxDiff = Math.max(lngDiff, latDiff);

        // Convert to zoom level (this is a rough approximation)
        const zoom = Math.max(1, Math.min(20, 14 - Math.log2(maxDiff * 100)));

        setViewState({
          longitude: centerLng,
          latitude: centerLat,
          zoom,
          pitch: 0,
          bearing: 0,
        });

        // Reset rubber band state
        setIsRubberBandZooming(false);
        setRubberBandStart(null);
        setRubberBandEnd(null);
      }
    },
    [isRubberBandZooming, rubberBandStart, rubberBandEnd]
  );

  // Handle drag start
  const handleDragStart = useCallback(
    (info: any) => {
      if (drawMode === "none" && info.object && info.layer) {
        const layerId = info.layer.id;
        const layer = layers.find((l) => l.id === layerId);

        // Only allow dragging for non-uploaded layers
        if (layer && !layer.isUploaded) {
          setIsDragging(true);
          setDraggedLayerId(layerId);
          setDragStartPosition([info.coordinate[0], info.coordinate[1]]);
          setOriginalLayerData(JSON.parse(JSON.stringify(layer.data))); // Deep copy
        }
      }
    },
    [drawMode, layers]
  );

  // Handle drag
  const handleDrag = useCallback(
    (info: any) => {
      if (
        isDragging &&
        draggedLayerId &&
        dragStartPosition &&
        originalLayerData &&
        info.coordinate
      ) {
        const layer = layers.find((l) => l.id === draggedLayerId);
        if (!layer) return;

        const totalDeltaLng = info.coordinate[0] - dragStartPosition[0];
        const totalDeltaLat = info.coordinate[1] - dragStartPosition[1];

        setLayers((prev) =>
          prev.map((l) => {
            if (l.id === draggedLayerId) {
              const newData = originalLayerData.map((item: any) => {
                if (l.type === "point") {
                  return {
                    ...item,
                    position: [
                      item.position[0] + totalDeltaLng,
                      item.position[1] + totalDeltaLat,
                    ],
                  };
                } else if (
                  l.type === "polygon" ||
                  l.type === "sector" ||
                  l.type === "area"
                ) {
                  return {
                    ...item,
                    polygon: item.polygon.map((point: [number, number]) => [
                      point[0] + totalDeltaLng,
                      point[1] + totalDeltaLat,
                    ]),
                  };
                } else if (
                  l.type === "distance" ||
                  l.type === "azimuth" ||
                  l.type === "line"
                ) {
                  return {
                    ...item,
                    path: item.path.map((point: [number, number]) => [
                      point[0] + totalDeltaLng,
                      point[1] + totalDeltaLat,
                    ]),
                  };
                }
                return item;
              });

              return { ...l, data: newData };
            }
            return l;
          })
        );
      }
    },
    [isDragging, draggedLayerId, dragStartPosition, originalLayerData, layers]
  );

  // Handle drag end
  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDraggedLayerId(null);
    setDragStartPosition(null);
    setOriginalLayerData(null);
  }, []);

  // Helper function to create sector polygon
  const createSectorPolygon = (
    center: [number, number],
    radius: number,
    startAngle: number,
    endAngle: number
  ): [number, number][] => {
    const points: [number, number][] = [center];
    const numPoints = 32; // Number of points to approximate the arc

    // Ensure endAngle is greater than startAngle
    let normalizedEndAngle = endAngle;
    while (normalizedEndAngle <= startAngle) {
      normalizedEndAngle += 2 * Math.PI;
    }

    // Generate points along the arc
    for (let i = 0; i <= numPoints; i++) {
      const angle =
        startAngle + (normalizedEndAngle - startAngle) * (i / numPoints);
      const x = center[0] + radius * Math.cos(angle);
      const y = center[1] + radius * Math.sin(angle);
      points.push([x, y]);
    }

    return points;
  };

  // Helper function to calculate distance between two points (in km)
  const calculateDistance = (
    point1: [number, number],
    point2: [number, number]
  ): number => {
    const R = 6371; // Earth's radius in km
    const dLat = ((point2[1] - point1[1]) * Math.PI) / 180;
    const dLon = ((point2[0] - point1[0]) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((point1[1] * Math.PI) / 180) *
        Math.cos((point2[1] * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  // Helper function to calculate polygon area (in km²)
  const calculatePolygonArea = (polygon: [number, number][]): number => {
    const R = 6371; // Earth's radius in km
    let area = 0;

    for (let i = 0; i < polygon.length - 1; i++) {
      const p1 = polygon[i];
      const p2 = polygon[i + 1];

      area +=
        (((p2[0] - p1[0]) * (p2[1] + p1[1]) * Math.PI) / 180) *
        R *
        R *
        Math.cos((((p1[1] + p2[1]) / 2) * Math.PI) / 180);
    }

    return Math.abs(area) / 2;
  };

  // Helper function to calculate azimuth between two points (in degrees)
  const calculateAzimuth = (
    point1: [number, number],
    point2: [number, number]
  ): number => {
    const dLon = ((point2[0] - point1[0]) * Math.PI) / 180;
    const lat1 = (point1[1] * Math.PI) / 180;
    const lat2 = (point2[1] * Math.PI) / 180;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    let azimuth = (Math.atan2(y, x) * 180) / Math.PI;
    if (azimuth < 0) azimuth += 360;

    return azimuth;
  };

  // Create DeckGL layers from our layer state
  const deckLayers: any[] = [];

  // Add network nodes layer if it exists and is visible
  if (networkNodesLayer && networkNodesLayer.visible) {
    const pointDisplayMode = networkNodesLayer.pointDisplayMode || "circle";

    if (pointDisplayMode === "circle") {
      deckLayers.push(
        new ScatterplotLayer({
          id: networkNodesLayer.id,
          data: networkNodesLayer.data,
          getPosition: (d: any) => d.position,
          getRadius: (d: any) => networkNodesLayer.radius || 12,
          getFillColor: (d: any) => {
            // Color based on SNR value
            const node = d.node;
            if (node.snr > 20) return [0, 255, 0, 255]; // Green for excellent SNR
            if (node.snr > 15) return [255, 255, 0, 255]; // Yellow for good SNR
            if (node.snr > 10) return [255, 165, 0, 255]; // Orange for fair SNR
            return [255, 0, 0, 255]; // Red for poor SNR
          },
          filled: true,
          radiusUnits: "pixels",
          pickable: true,
        })
      );
    } else {
      // Icon mode - use IconLayer with default deck.gl icon atlas
      const iconAtlas =
        "https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.png";
      const iconMapping = {
        marker: { x: 0, y: 0, width: 128, height: 128, mask: true },
        pin: { x: 128, y: 0, width: 128, height: 128, mask: true },
        wifi: { x: 0, y: 0, width: 128, height: 128, mask: true }, // Use marker for wifi
        circle: { x: 128, y: 128, width: 128, height: 128, mask: true },
      };

      const iconType = networkNodesLayer.iconType || "marker";

      deckLayers.push(
        new IconLayer({
          id: `${networkNodesLayer.id}-icon`,
          data: networkNodesLayer.data,
          pickable: true,
          iconAtlas,
          iconMapping,
          getIcon: () => iconType,
          sizeScale: 1,
          getPosition: (d: any) => d.position,
          getSize: (d: any) => (networkNodesLayer.radius || 12) * 2,
          getColor: (d: any) => {
            // Color based on SNR value
            const node = d.node;
            if (node.snr > 20) return [0, 255, 0, 255]; // Green for excellent SNR
            if (node.snr > 15) return [255, 255, 0, 255]; // Yellow for good SNR
            if (node.snr > 10) return [255, 165, 0, 255]; // Orange for fair SNR
            return [255, 0, 0, 255]; // Red for poor SNR
          },
        })
      );
    }
  }

  // Add user layers (limit to first 50 for performance)
  layers
    .filter((layer) => layer.visible)
    .slice(0, 50) // Limit to 50 layers for better performance
    .forEach((layer) => {
      const color = hexToRgb(layer.color);

      switch (layer.type) {
        case "point":
          const pointDisplayMode = layer.pointDisplayMode || "circle";

          if (pointDisplayMode === "circle") {
            deckLayers.push(
              new ScatterplotLayer({
                id: `${layer.id}-radius-${layer.radius || 12}-color-${
                  layer.color
                }`,
                data: layer.data,
                getPosition: (d: any) => d.position,
                getRadius: (d: any) => layer.radius || 12,
                getFillColor: (d: any) => color.concat([255]),
                filled: true,
                radiusUnits: "pixels",
                pickable: true,
              })
            );
          } else {
            // Icon mode - use IconLayer with deck.gl icon atlas
            const iconAtlas =
              "https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.png";
            const iconMapping = {
              marker: { x: 0, y: 0, width: 128, height: 128, mask: true },
              pin: { x: 128, y: 0, width: 128, height: 128, mask: true },
              star: { x: 0, y: 128, width: 128, height: 128, mask: true },
              circle: { x: 128, y: 128, width: 128, height: 128, mask: true },
            };

            const iconType = layer.iconType || "marker";

            deckLayers.push(
              new IconLayer({
                id: `${layer.id}-icon-radius-${layer.radius || 12}-color-${
                  layer.color
                }`,
                data: layer.data,
                pickable: true,
                iconAtlas,
                iconMapping,
                getIcon: () => iconType,
                sizeScale: 1,
                getPosition: (d: any) => d.position,
                getSize: (d: any) => (layer.radius || 12) * 2,
                getColor: (d: any) => color.concat([255]),
              })
            );
          }
          break;
        case "polygon":
        case "sector":
        case "area":
          deckLayers.push(
            new PolygonLayer({
              id: `${layer.id}-color-${layer.color}`,
              data: layer.data,
              getPolygon: (d: any) => d.polygon,
              getFillColor: (d: any) => color.concat([128]),
              filled: true,
              pickable: true,
            })
          );

          // Add vertex points for polygons and areas
          if (layer.type === "polygon" || layer.type === "area") {
            const vertices = layer.data[0].polygon.slice(0, -1); // Remove the last point as it's the same as first
            deckLayers.push(
              new ScatterplotLayer({
                id: `${layer.id}-vertices`,
                data: vertices.map((vertex: [number, number]) => ({
                  position: vertex,
                })),
                getPosition: (d: any) => d.position,
                getRadius: 100,
                getFillColor: color.concat([255]),
                radiusUnits: "meters",
                pickable: false,
              })
            );
          }
          break;
        case "line":
        case "distance":
        case "azimuth":
          deckLayers.push(
            new PathLayer({
              id: `${layer.id}-color-${layer.color}`,
              data: layer.data,
              getPath: (d: any) => d.path,
              getColor: (d: any) => color.concat([255]),
              getWidth: 3,
              widthUnits: "pixels",
              pickable: true,
            })
          );
          break;
      }
    });

  // Add drawing feedback layer
  if (drawingPoints.length > 0) {
    deckLayers.push(
      new ScatterplotLayer({
        id: "drawing-points",
        data: drawingPoints.map((p) => ({ position: p })),
        getPosition: (d: any) => d.position,
        getRadius: 8,
        getFillColor: [255, 165, 0, 255], // Orange
        radiusUnits: "pixels",
        pickable: false,
      })
    );

    if (drawingPoints.length > 1) {
      deckLayers.push(
        new PathLayer({
          id: "drawing-line",
          data: [{ path: drawingPoints }],
          getPath: (d: any) => d.path,
          getColor: [255, 165, 0, 255], // Orange
          getWidth: 2,
          widthUnits: "pixels",
          pickable: false,
        })
      );
    }

    // Add mouse position preview for line drawing
    if (mousePosition && drawMode === "line" && drawingPoints.length === 1) {
      // Show preview line from first point to mouse
      const previewPath = [...drawingPoints, mousePosition];
      deckLayers.push(
        new PathLayer({
          id: "line-preview",
          data: [{ path: previewPath }],
          getPath: (d: any) => d.path,
          getColor: [255, 165, 0, 128], // Orange with transparency
          getWidth: 2,
          widthUnits: "pixels",
          pickable: false,
        })
      );

      // Show mouse position point
      deckLayers.push(
        new ScatterplotLayer({
          id: "line-mouse-position",
          data: [{ position: mousePosition }],
          getPosition: (d: any) => d.position,
          getRadius: 6,
          getFillColor: [255, 165, 0, 128], // Orange with transparency
          radiusUnits: "pixels",
          pickable: false,
        })
      );
    }

    // Add mouse position preview for polygon drawing
    if (mousePosition && drawMode === "polygon") {
      // Show preview line from last point to mouse
      const previewPath = [...drawingPoints, mousePosition];
      deckLayers.push(
        new PathLayer({
          id: "polygon-preview-line",
          data: [{ path: previewPath }],
          getPath: (d: any) => d.path,
          getColor: [255, 165, 0, 128], // Orange with transparency
          getWidth: 2,
          widthUnits: "pixels",
          pickable: false,
        })
      );

      // Show mouse position point
      deckLayers.push(
        new ScatterplotLayer({
          id: "mouse-position",
          data: [{ position: mousePosition }],
          getPosition: (d: any) => d.position,
          getRadius: 6,
          getFillColor: [255, 165, 0, 128], // Orange with transparency
          radiusUnits: "pixels",
          pickable: false,
        })
      );

      // Add polygon preview when we have 3 or more points
      if (drawingPoints.length >= 2) {
        const previewPolygon = [
          ...drawingPoints,
          mousePosition,
          drawingPoints[0],
        ]; // Close the polygon
        deckLayers.push(
          new PolygonLayer({
            id: "polygon-preview",
            data: [{ polygon: previewPolygon }],
            getPolygon: (d: any) => d.polygon,
            getFillColor: [255, 165, 0, 64], // Orange with low opacity
            getLineColor: [255, 165, 0, 255], // Orange
            stroked: true,
            filled: true,
            getLineWidth: 2,
            lineWidthUnits: "pixels",
            pickable: false,
          })
        );
      }

      // Add special visual indicator when hovering over the first point
      if (hoveredPoint && drawingPoints.length >= 2) {
        // Highlight the first point with a different color and larger size
        deckLayers.push(
          new ScatterplotLayer({
            id: "first-point-highlight",
            data: [{ position: drawingPoints[0] }],
            getPosition: (d: any) => d.position,
            getRadius: 20, // Larger pixel radius for better visibility
            getFillColor: [0, 255, 0, 255], // Bright green with full opacity
            radiusUnits: "pixels", // Use pixels for consistent visual size
            pickable: true, // Make it clickable
          })
        );

        // Add a pulsing ring around the first point
        deckLayers.push(
          new ScatterplotLayer({
            id: "first-point-ring",
            data: [{ position: drawingPoints[0] }],
            getPosition: (d: any) => d.position,
            getRadius: 40, // Larger ring
            getFillColor: [0, 255, 0, 64], // Green with transparency
            radiusUnits: "pixels",
            pickable: false,
          })
        );
      }
    }

    // Add mouse position preview for distance measurement
    if (
      mousePosition &&
      drawMode === "distance" &&
      drawingPoints.length === 1
    ) {
      // Show preview line from first point to mouse
      const previewPath = [...drawingPoints, mousePosition];
      deckLayers.push(
        new PathLayer({
          id: "distance-preview",
          data: [{ path: previewPath }],
          getPath: (d: any) => d.path,
          getColor: [0, 0, 255, 128], // Blue with transparency
          getWidth: 2,
          widthUnits: "pixels",
          pickable: false,
        })
      );

      // Show mouse position point
      deckLayers.push(
        new ScatterplotLayer({
          id: "distance-mouse-position",
          data: [{ position: mousePosition }],
          getPosition: (d: any) => d.position,
          getRadius: 6,
          getFillColor: [0, 0, 255, 128], // Blue with transparency
          radiusUnits: "pixels",
          pickable: false,
        })
      );
    }

    // Add mouse position preview for area drawing
    if (mousePosition && drawMode === "area") {
      // Show preview line from last point to mouse
      const previewPath = [...drawingPoints, mousePosition];
      deckLayers.push(
        new PathLayer({
          id: "area-preview-line",
          data: [{ path: previewPath }],
          getPath: (d: any) => d.path,
          getColor: [0, 255, 0, 128], // Green with transparency
          getWidth: 2,
          widthUnits: "pixels",
          pickable: false,
        })
      );

      // Show mouse position point
      deckLayers.push(
        new ScatterplotLayer({
          id: "area-mouse-position",
          data: [{ position: mousePosition }],
          getPosition: (d: any) => d.position,
          getRadius: 6,
          getFillColor: [0, 255, 0, 128], // Green with transparency
          radiusUnits: "pixels",
          pickable: false,
        })
      );

      // Add area preview when we have 3 or more points
      if (drawingPoints.length >= 2) {
        const previewPolygon = [
          ...drawingPoints,
          mousePosition,
          drawingPoints[0],
        ]; // Close the polygon
        deckLayers.push(
          new PolygonLayer({
            id: "area-preview",
            data: [{ polygon: previewPolygon }],
            getPolygon: (d: any) => d.polygon,
            getFillColor: [0, 255, 0, 64], // Green with low opacity
            getLineColor: [0, 255, 0, 255], // Green
            stroked: true,
            filled: true,
            getLineWidth: 2,
            lineWidthUnits: "pixels",
            pickable: false,
          })
        );
      }

      // Add special visual indicator when hovering over the first point
      if (hoveredPoint && drawingPoints.length >= 2) {
        // Highlight the first point with a different color and larger size
        deckLayers.push(
          new ScatterplotLayer({
            id: "area-first-point-highlight",
            data: [{ position: drawingPoints[0] }],
            getPosition: (d: any) => d.position,
            getRadius: 20, // Larger pixel radius for better visibility
            getFillColor: [0, 255, 0, 255], // Bright green with full opacity
            radiusUnits: "pixels", // Use pixels for consistent visual size
            pickable: true, // Make it clickable
          })
        );

        // Add a pulsing ring around the first point
        deckLayers.push(
          new ScatterplotLayer({
            id: "area-first-point-ring",
            data: [{ position: drawingPoints[0] }],
            getPosition: (d: any) => d.position,
            getRadius: 40, // Larger ring
            getFillColor: [0, 255, 0, 64], // Green with transparency
            radiusUnits: "pixels",
            pickable: false,
          })
        );
      }
    }
  }

  // Add sector drawing feedback
  if (sectorCenter) {
    // Center point
    deckLayers.push(
      new ScatterplotLayer({
        id: "sector-center",
        data: [{ position: sectorCenter }],
        getPosition: (d: any) => d.position,
        getRadius: 8,
        getFillColor: [255, 0, 0, 255], // Red
        radiusUnits: "pixels",
        pickable: false,
      })
    );

    // Radius preview line
    if (sectorRadius > 0) {
      const radiusEndPoint = [
        sectorCenter[0] + sectorRadius * Math.cos(sectorStartAngle),
        sectorCenter[1] + sectorRadius * Math.sin(sectorStartAngle),
      ];

      deckLayers.push(
        new PathLayer({
          id: "sector-radius-preview",
          data: [{ path: [sectorCenter, radiusEndPoint] }],
          getPath: (d: any) => d.path,
          getColor: [255, 0, 0, 255], // Red
          getWidth: 2,
          widthUnits: "pixels",
          pickable: false,
        })
      );

      // Sector preview
      if (mousePosition) {
        const endAngle = Math.atan2(
          mousePosition[1] - sectorCenter[1],
          mousePosition[0] - sectorCenter[0]
        );
        const sectorPolygon = createSectorPolygon(
          sectorCenter,
          sectorRadius,
          sectorStartAngle,
          endAngle
        );

        deckLayers.push(
          new PolygonLayer({
            id: "sector-preview",
            data: [{ polygon: sectorPolygon }],
            getPolygon: (d: any) => d.polygon,
            getFillColor: [255, 165, 0, 64], // Orange with low opacity
            getLineColor: [255, 165, 0, 255], // Orange
            stroked: true,
            filled: true,
            getLineWidth: 2,
            lineWidthUnits: "pixels",
            pickable: false,
          })
        );
      }
    }
  }

  // Add rubber band rectangle
  if (isRubberBandZooming && rubberBandStart && rubberBandEnd) {
    const minLng = Math.min(rubberBandStart[0], rubberBandEnd[0]);
    const maxLng = Math.max(rubberBandStart[0], rubberBandEnd[0]);
    const minLat = Math.min(rubberBandStart[1], rubberBandEnd[1]);
    const maxLat = Math.max(rubberBandStart[1], rubberBandEnd[1]);

    const rubberBandPolygon = [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
      [minLng, minLat],
    ];

    deckLayers.push(
      new PolygonLayer({
        id: "rubber-band",
        data: [{ polygon: rubberBandPolygon }],
        getPolygon: (d: any) => d.polygon,
        getFillColor: [0, 123, 255, 32], // Blue with low opacity
        getLineColor: [0, 123, 255, 255], // Blue
        stroked: true,
        filled: true,
        getLineWidth: 2,
        lineWidthUnits: "pixels",
        pickable: false,
      })
    );
  }

  // Add socket connection lines layer
  if (socketData && Array.isArray(socketData) && socketData.length > 0) {
    // Create connection lines between nodes
    const connectionLines: any[] = [];
    socketData.forEach((node: any) => {
      if (node.connectedNodeIds && Array.isArray(node.connectedNodeIds)) {
        node.connectedNodeIds.forEach((connectedId: number) => {
          const connectedNode = socketData.find(
            (n: any) => n.userId === connectedId
          );
          if (connectedNode) {
            connectionLines.push({
              path: [
                [node.longitude, node.latitude],
                [connectedNode.longitude, connectedNode.latitude],
              ],
              fromUserId: node.userId,
              toUserId: connectedId,
            });
          }
        });
      }
    });

    if (connectionLines.length > 0) {
      deckLayers.push(
        new PathLayer({
          id: "socket-connections",
          data: connectionLines,
          getPath: (d: any) => d.path,
          getColor: [0, 123, 255, 180], // Blue with transparency
          getWidth: 2,
          widthUnits: "pixels",
          pickable: false,
        })
      );
    }
  }

  // Add tooltip layer that moves with the map
  if (tooltipInfo) {
    // Create a custom tooltip layer using TextLayer
    deckLayers.push(
      new ScatterplotLayer({
        id: "tooltip-marker",
        data: [
          {
            position: tooltipInfo.coordinate,
            text: tooltipInfo.layer.name,
            type: tooltipInfo.layer.type,
            color: tooltipInfo.layer.color,
            radius: tooltipInfo.layer.radius,
            measurement: tooltipInfo.layer.measurement,
            nodeData:
              tooltipInfo.layer.id === "network-nodes"
                ? tooltipInfo.layer.data[0]
                : null,
          },
        ],
        getPosition: (d: any) => d.position,
        getRadius: 0, // Invisible marker
        getFillColor: [0, 0, 0, 0], // Transparent
        pickable: false,
      })
    );
  }

  return (
    <div className="relative w-full h-full">
      {/* Socket Connection Status */}
      {/* <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20">
        <div
          className={`flex items-center space-x-2 px-3 py-2 rounded-lg backdrop-blur-md ${
            isConnected
              ? "bg-green-500/90 text-white"
              : "bg-red-500/90 text-white"
          }`}
        >
          <div
            className={`w-2 h-2 rounded-full ${
              isConnected ? "bg-green-300" : "bg-red-300"
            }`}
          />
          <span className="text-sm font-medium">
            {isConnected ? "Socket Connected" : "Socket Disconnected"}
          </span>
        </div>
      </div> */}

      {/* Socket Nodes Legend */}
      {socketData && Array.isArray(socketData) && socketData.length > 0 && (
        <div className="absolute bottom-4 right-4 z-20">
          <div className="bg-white/90 backdrop-blur-md rounded-lg shadow-lg p-3 min-w-[200px]">
            <h3 className="text-sm font-semibold text-gray-800 mb-2">
              Signal Quality (SNR)
            </h3>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span className="text-xs text-gray-700">
                  Excellent (&gt;20 dB)
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <span className="text-xs text-gray-700">Good (15-20 dB)</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-orange-500"></div>
                <span className="text-xs text-gray-700">Fair (10-15 dB)</span>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span className="text-xs text-gray-700">Poor (≤10 dB)</span>
              </div>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-200">
              <div className="flex items-center space-x-2">
                <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
                <span className="text-xs text-gray-700">Node Connections</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Map */}
      <DeckGL
        ref={deckRef}
        viewState={viewState}
        onViewStateChange={({ viewState }) => {
          setViewState(viewState as any);
          // Disable tooltip updates during dragging for better performance
        }}
        controller={{
          dragPan: drawMode === "none" && !isDragging,
          dragRotate: false,
          scrollZoom: true,
          doubleClickZoom: true,
          keyboard: true,
          inertia: true,
          inertiaDeceleration: 0.98,
          inertiaMaxSpeed: 1000,
        }}
        layers={deckLayers}
        onClick={handleMapClick}
        onHover={handleMouseMove}
        onDragStart={(info) => {
          // Handle object dragging
          handleDragStart(info);
          // Handle rubber band zoom if not dragging an object
          // if (!isDragging) {
          //   handleRubberBandStart(info);
          // }
        }}
        //   onDrag={handleDrag}
        onDragEnd={(info) => {
          handleDragEnd();
          //  handleRubberBandEnd(info);
        }}
        style={{
          width: "100%",
          height: "100%",
          cursor: isDragging
            ? "grabbing"
            : hoveredPoint
            ? "pointer"
            : "default",
        }}
      >
        <Map
          mapboxAccessToken={import.meta.env.VITE_MAPBOX_TOKEN}
          style={{ width: "100%", height: "100%" }}
          mapStyle={mapStyle}
          reuseMaps
          onLoad={(event) => {
            const map = event.target;
            mapRef.current = map; // Store map reference

            // Add the DEM (Digital Elevation Model) source
            map.addSource("mapbox-dem", {
              type: "raster-dem",
              url: "mapbox://mapbox.terrain-rgb",
              tileSize: 512,
              maxzoom: 14,
            });

            // Initial terrain setup
            if (terrainEnabled) {
              map.setTerrain({
                source: "mapbox-dem",
                exaggeration: 1.0,
              });

              // Add hillshading
              map.addLayer({
                id: "hillshading",
                source: "mapbox-dem",
                type: "hillshade",
                paint: {
                  "hillshade-shadow-color": "#000000",
                  "hillshade-highlight-color": "#FFFFFF",
                  "hillshade-accent-color": "#000000",
                },
              });
            }

            // Enable rotation with trackpad
            map.dragRotate.enable();

            // Allow pinch rotation/tilt on touch devices
            map.touchZoomRotate.enableRotation();

            // Note: NavigationControl removed due to import issues
            // The compass control in bottom-right provides similar functionality
          }}
        />
      </DeckGL>

      {/* Tooltip Display */}
      {tooltipInfo && (
        <div
          className="absolute z-[9999] bg-black text-white px-4 py-3 rounded-lg shadow-2xl text-sm border-2 border-white max-w-xs pointer-events-none"
          style={{
            left: `${tooltipInfo.x}px`,
            top: `${tooltipInfo.y - 10}px`,
            transform: "translateY(-100%)",
            boxShadow: "0 20px 40px rgba(0,0,0,0.8)",
          }}
        >
          <div className="font-semibold text-white mb-2">
            {tooltipInfo.layer.name}
          </div>
          <div className="text-xs text-gray-300 mb-1">
            Type: {tooltipInfo.layer.type}
          </div>
          {tooltipInfo.layer.id === "network-nodes" &&
            tooltipInfo.layer.data &&
            tooltipInfo.layer.data.length > 0 && (
              <>
                <div className="text-xs text-gray-300 mb-1">
                  SNR: {tooltipInfo.layer.data[0].snr} dB
                </div>
                <div className="text-xs text-gray-300 mb-1">
                  RSSI: {tooltipInfo.layer.data[0].rssi} dBm
                </div>
                <div className="text-xs text-gray-300 mb-1">
                  Distance: {tooltipInfo.layer.data[0].distance} km
                </div>
                <div className="text-xs text-gray-300 mb-1">
                  Hop Count: {tooltipInfo.layer.data[0].hopCount}
                </div>
                <div className="text-xs text-gray-300 mb-1">
                  Connected Nodes:{" "}
                  {tooltipInfo.layer.data[0].connectedNodeIds?.length || 0}
                </div>
              </>
            )}
          {tooltipInfo.layer.id !== "network-nodes" && (
            <>
              <div className="text-xs text-gray-300 mb-1">
                Color: {tooltipInfo.layer.color}
              </div>
              {tooltipInfo.layer.type === "point" &&
                tooltipInfo.layer.radius && (
                  <div className="text-xs text-gray-300 mb-1">
                    Radius: {tooltipInfo.layer.radius}px
                  </div>
                )}
              {(tooltipInfo.layer.type === "area" ||
                tooltipInfo.layer.type === "distance") &&
                tooltipInfo.layer.measurement && (
                  <div className="text-xs text-gray-300 mb-1">
                    {tooltipInfo.layer.type === "area" ? "Area" : "Distance"}:{" "}
                    {tooltipInfo.layer.measurement}
                  </div>
                )}
            </>
          )}
          <div className="text-xs text-gray-300">
            Coordinates: {tooltipInfo.coordinate[0].toFixed(4)},{" "}
            {tooltipInfo.coordinate[1].toFixed(4)}
          </div>

          {/* Close button */}
          <button
            onClick={() => setTooltipInfo(null)}
            className="absolute top-2 right-2 text-white hover:text-gray-300 text-lg font-bold pointer-events-auto"
            style={{ fontSize: "16px" }}
          >
            ×
          </button>
        </div>
      )}

      {/* Performance Info */}
      <div className="absolute top-20 left-4 bg-white/90 backdrop-blur-md border border-gray-200/50 rounded-lg shadow-lg p-2 z-10">
        <div className="text-xs text-gray-700">
          Layers: {layers.filter((l) => l.visible).length}/50
        </div>
        <div className="text-xs text-gray-500">
          Terrain: {terrainEnabled ? "ON" : "OFF"}
        </div>
        {layers.filter((l) => l.visible).length > 40 && (
          <div className="text-xs text-red-500 font-bold">
            Performance: Consider disabling some layers
          </div>
        )}
      </div>

      {/* Zoom Controls */}
      <div className="absolute top-4 right-4 flex flex-col gap-2 z-10">
        <button
          onClick={zoomIn}
          className="w-10 h-10 bg-white/90 backdrop-blur-md border border-gray-200/50 rounded-lg shadow-lg flex items-center justify-center hover:bg-white transition-colors"
          title="Zoom In"
        >
          <Icon icon="mdi:plus" className="h-5 w-5 text-gray-700" />
        </button>
        <button
          onClick={zoomOut}
          className="w-10 h-10 bg-white/90 backdrop-blur-md border border-gray-200/50 rounded-lg shadow-lg flex items-center justify-center hover:bg-white transition-colors"
          title="Zoom Out"
        >
          <Icon icon="mdi:minus" className="h-5 w-5 text-gray-700" />
        </button>
        <button
          onClick={resetView}
          className="w-10 h-10 bg-white/90 backdrop-blur-md border border-gray-200/50 rounded-lg shadow-lg flex items-center justify-center hover:bg-white transition-colors"
          title="Reset View"
        >
          <Icon icon="mdi:home" className="h-5 w-5 text-gray-700" />
        </button>

        {/* Save/Load Preferences */}
        <div className="mt-2 pt-2 border-t border-gray-200/50">
          <button
            onClick={savePreferences}
            className="w-10 h-10 bg-green-500/90 backdrop-blur-md border border-green-200/50 rounded-lg shadow-lg flex items-center justify-center hover:bg-green-500 transition-colors"
            title="Save Preferences"
          >
            <Icon icon="mdi:content-save" className="h-5 w-5 text-white" />
          </button>
          <button
            onClick={loadPreferences}
            className="w-10 h-10 bg-blue-500/90 backdrop-blur-md border border-blue-200/50 rounded-lg shadow-lg flex items-center justify-center hover:bg-blue-500 transition-colors mt-2"
            title="Load Preferences"
          >
            <Icon icon="mdi:folder-open" className="h-5 w-5 text-white" />
          </button>
        </div>

        {/* Download/Upload Data */}
        <div className="mt-2 pt-2 border-t border-gray-200/50">
          <button
            onClick={downloadData}
            className="w-10 h-10 bg-orange-500/90 backdrop-blur-md border border-orange-200/50 rounded-lg shadow-lg flex items-center justify-center hover:bg-orange-500 transition-colors"
            title="Download All Data as JSON"
          >
            <Icon icon="mdi:download" className="h-5 w-5 text-white" />
          </button>
          <div className="mt-2">
            <input
              type="file"
              accept=".json"
              onChange={uploadData}
              className="hidden"
              id="upload-data-input"
            />
            <button
              onClick={() =>
                document.getElementById("upload-data-input")?.click()
              }
              className="w-10 h-10 bg-indigo-500/90 backdrop-blur-md border border-indigo-200/50 rounded-lg shadow-lg flex items-center justify-center hover:bg-indigo-500 transition-colors"
              title="Upload Data from JSON"
            >
              <Icon icon="mdi:upload" className="h-5 w-5 text-white" />
            </button>
          </div>
        </div>

        {/* Test Layer Button */}
        {/* <div className="mt-2 pt-2 border-t border-gray-200/50">
          <button
            onClick={() => {
              const testLayer: Layer = {
                id: generateLayerId(),
                name: "Test Stroke Layer",
                type: "point",
                data: [{ position: [78.9629, 20.5937] }],
                color: "#ff0000",
                icon: "mdi:map-marker",
                visible: true,
                radius: 20,
                pointDisplayMode: "circle",
                iconType: "marker",
              };
              setLayers((prev) => [...prev, testLayer]);
            }}
            className="w-10 h-10 bg-purple-500/90 backdrop-blur-md border border-purple-200/50 rounded-lg shadow-lg flex items-center justify-center hover:bg-purple-500 transition-colors"
            title="Add Test Layer"
          >
            <Icon icon="mdi:test-tube" className="h-5 w-5 text-white" />
          </button>
        </div> */}

        {/* Test Layer Button */}

        {/* Performance Mode Toggle */}
        <div className="mt-2 pt-2 border-t border-gray-200/50">
          <button
            onClick={() => setPerformanceMode(!performanceMode)}
            className={`w-10 h-10 backdrop-blur-md border rounded-lg shadow-lg flex items-center justify-center transition-colors ${
              performanceMode
                ? "bg-green-500/90 border-green-200/50 hover:bg-green-500"
                : "bg-orange-500/90 border-orange-200/50 hover:bg-orange-500"
            }`}
            title={
              performanceMode ? "Performance Mode ON" : "Performance Mode OFF"
            }
          >
            <Icon
              icon={
                performanceMode ? "mdi:speedometer" : "mdi:speedometer-slow"
              }
              className="h-5 w-5 text-white"
            />
          </button>
        </div>

        {/* Terrain Toggle */}
        <div className="mt-2 pt-2 border-t border-gray-200/50">
          <button
            onClick={() => {
              const newTerrainState = !terrainEnabled;
              setTerrainEnabled(newTerrainState);
              // Toggle terrain after state update
              setTimeout(() => {
                if (mapRef.current) {
                  const map = mapRef.current;
                  console.log("Toggling terrain:", newTerrainState);
                  if (newTerrainState) {
                    console.log("Enabling terrain...");
                    map.setTerrain({
                      source: "mapbox-dem",
                      exaggeration: 1.0,
                    });
                    if (!map.getLayer("hillshading")) {
                      console.log("Adding hillshading layer...");
                      map.addLayer({
                        id: "hillshading",
                        source: "mapbox-dem",
                        type: "hillshade",
                        paint: {
                          "hillshade-shadow-color": "#000000",
                          "hillshade-highlight-color": "#FFFFFF",
                          "hillshade-accent-color": "#000000",
                        },
                      });
                    }
                    console.log("Terrain enabled successfully");
                  } else {
                    console.log("Disabling terrain...");
                    map.setTerrain(null);
                    if (map.getLayer("hillshading")) {
                      map.removeLayer("hillshading");
                    }
                    console.log("Terrain disabled successfully");
                  }
                } else {
                  console.log("Map reference not available");
                }
              }, 100);
            }}
            className={`w-10 h-10 backdrop-blur-md border rounded-lg shadow-lg flex items-center justify-center transition-colors ${
              terrainEnabled
                ? "bg-green-500/90 border-green-200/50 hover:bg-green-500"
                : "bg-gray-500/90 border-gray-200/50 hover:bg-gray-500"
            }`}
            title={terrainEnabled ? "Disable 3D Terrain" : "Enable 3D Terrain"}
          >
            <Icon
              icon={terrainEnabled ? "mdi:terrain" : "mdi:terrain-off"}
              className="h-5 w-5 text-white"
            />
          </button>
        </div>

        {/* Start Fresh Button */}
        <div className="mt-2 pt-2 border-t border-gray-200/50">
          <button
            onClick={startFresh}
            className="w-10 h-10 bg-red-500/90 backdrop-blur-md border border-red-200/50 rounded-lg shadow-lg flex items-center justify-center hover:bg-red-500 transition-colors"
            title="Start Fresh - Reset Everything"
          >
            <Icon icon="mdi:refresh" className="h-5 w-5 text-white" />
          </button>
        </div>
      </div>

      {/* Floating Sidebar */}
      <div
        className={`absolute top-4 left-4 bg-white border border-gray-200 rounded-xl shadow-xl z-10 flex flex-col transition-all duration-300 ${
          isSidebarCollapsed ? "w-80 h-12" : "w-80 h-[calc(100vh-2rem)]"
        }`}
      >
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon icon="mdi:layers" className="h-5 w-5 text-gray-600" />
            </div>
            <button
              onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              className="p-1 hover:bg-gray-100 rounded transition-colors"
              title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              <Icon
                icon={
                  isSidebarCollapsed ? "mdi:chevron-down" : "mdi:chevron-up"
                }
                className="h-4 w-4 text-gray-600"
              />
            </button>
          </div>
        </div>

        <div
          className={`flex-1 overflow-y-auto scrollbar-thin ${
            isSidebarCollapsed ? "hidden" : ""
          }`}
        >
          {/* Untitled Section */}

          {/* Upload Area */}
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 text-center bg-gray-50 m-4">
            <Icon
              icon="mdi:cloud-upload"
              className="h-8 w-8 text-gray-400 mx-auto mb-2"
            />
            <p className="text-sm text-gray-600 mb-1">Upload a New Layer</p>
            <p className="text-xs text-gray-500">
              (CSV, Excel, GeoJSON, Shapefile .zip only)
            </p>

            <input
              type="file"
              accept=".csv,.geojson,.json,.xlsx,.xls,.zip"
              onChange={handleFileUpload}
              className="hidden"
              id="file-upload-input"
            />
            <button
              onClick={() =>
                document.getElementById("file-upload-input")?.click()
              }
              className="mt-3 px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors"
            >
              Choose File
            </button>
          </div>

          {/* New Folder Creation */}
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-700">Folders</h3>
              <button
                onClick={() => setIsCreatingFolder(!isCreatingFolder)}
                className="p-1 hover:bg-gray-100 rounded transition-colors"
                title="Add new folder"
              >
                <Icon
                  icon="mdi:folder-plus"
                  className="h-4 w-4 text-gray-600"
                />
              </button>
            </div>

            {isCreatingFolder && (
              <div className="flex items-center gap-2 mb-3">
                <input
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addCustomFolder();
                    if (e.key === "Escape") {
                      setIsCreatingFolder(false);
                      setNewFolderName("");
                    }
                  }}
                  placeholder="Folder name"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                />
                <button
                  onClick={addCustomFolder}
                  className="px-3 py-2 bg-green-500 text-white rounded-lg text-sm font-medium hover:bg-green-600 transition-colors"
                >
                  Add
                </button>
                <button
                  onClick={() => {
                    setIsCreatingFolder(false);
                    setNewFolderName("");
                  }}
                  className="px-3 py-2 bg-gray-500 text-white rounded-lg text-sm font-medium hover:bg-gray-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* Custom Folders */}
            {customFolders.map((folderName) => (
              <Collapsible
                key={folderName}
                open={
                  !collapsedSections[
                    folderName as keyof typeof collapsedSections
                  ]
                }
                onOpenChange={(open) =>
                  setCollapsedSections((prev) => ({
                    ...prev,
                    [folderName]: !open,
                  }))
                }
              >
                <div className="p-2 border border-gray-200 rounded-lg mb-2">
                  <CollapsibleTrigger className="group flex items-center gap-2 w-full text-left hover:bg-gray-50 rounded p-1">
                    <Icon icon="mdi:folder" className="h-4 w-4 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700 flex-1">
                      {folderName}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeCustomFolder(folderName);
                      }}
                      className="p-1 hover:bg-red-100 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Delete folder"
                    >
                      <Icon
                        icon="mdi:delete"
                        className="h-3 w-3 text-red-500"
                      />
                    </button>
                    <Icon
                      icon={
                        collapsedSections[
                          folderName as keyof typeof collapsedSections
                        ]
                          ? "mdi:chevron-right"
                          : "mdi:chevron-down"
                      }
                      className="h-3 w-3 text-gray-400"
                    />
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <div className="space-y-2 mt-2">
                      {layers
                        .filter((layer) => layer.folder === folderName)
                        .map((layer) => (
                          <div
                            key={layer.id}
                            className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                          >
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => toggleLayerVisibility(layer.id)}
                                className="p-1"
                              >
                                <Icon
                                  icon={
                                    layer.visible ? "mdi:eye" : "mdi:eye-off"
                                  }
                                  className="h-4 w-4 text-gray-600"
                                />
                              </button>
                              <Icon
                                icon={layer.icon}
                                className="h-4 w-4"
                                style={{ color: layer.color }}
                              />
                              <span className="text-sm text-gray-700 truncate max-w-32">
                                {layer.name}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    className="text-purple-500 hover:text-purple-700"
                                    title="Move to folder"
                                  >
                                    <Icon
                                      icon="mdi:folder-move"
                                      className="h-4 w-4"
                                    />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-48">
                                  <div className="space-y-2">
                                    <h4 className="font-medium text-sm">
                                      Move to folder:
                                    </h4>
                                    <button
                                      onClick={() =>
                                        moveLayerToFolder(layer.id, "drawn")
                                      }
                                      className="w-full text-left px-2 py-1 text-sm hover:bg-gray-100 rounded"
                                    >
                                      {folderNames.drawn}
                                    </button>
                                    <button
                                      onClick={() =>
                                        moveLayerToFolder(layer.id, "uploaded")
                                      }
                                      className="w-full text-left px-2 py-1 text-sm hover:bg-gray-100 rounded"
                                    >
                                      {folderNames.uploaded}
                                    </button>
                                    <button
                                      onClick={() =>
                                        moveLayerToFolder(layer.id, "untitled")
                                      }
                                      className="w-full text-left px-2 py-1 text-sm hover:bg-gray-100 rounded"
                                    >
                                      {folderNames.untitled}
                                    </button>
                                    {customFolders
                                      .filter((f) => f !== folderName)
                                      .map((customFolder) => (
                                        <button
                                          key={customFolder}
                                          onClick={() =>
                                            moveLayerToFolder(
                                              layer.id,
                                              customFolder
                                            )
                                          }
                                          className="w-full text-left px-2 py-1 text-sm hover:bg-gray-100 rounded"
                                        >
                                          {customFolder}
                                        </button>
                                      ))}
                                  </div>
                                </PopoverContent>
                              </Popover>
                              <button
                                onClick={() => removeLayer(layer.id)}
                                className="text-red-500 hover:text-red-700"
                                title="Delete layer"
                              >
                                <Icon icon="mdi:delete" className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))}
          </div>

          {/* Drawn Section */}
          {layers.filter((layer) => !layer.isUploaded).length > 0 && (
            <Collapsible
              open={!collapsedSections.drawn}
              onOpenChange={(open) =>
                setCollapsedSections((prev) => ({ ...prev, drawn: !open }))
              }
            >
              <div className="p-4 border-b border-gray-100">
                <CollapsibleTrigger className="group flex items-center gap-2 mb-3 w-full text-left hover:bg-gray-50 rounded p-1">
                  <Icon icon="mdi:folder" className="h-4 w-4 text-gray-500" />
                  {editingFolder === "drawn" ? (
                    <div className="flex items-center gap-1 flex-1">
                      <input
                        type="text"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveFolderName("drawn");
                          if (e.key === "Escape") cancelEditingFolder();
                        }}
                        onBlur={() => saveFolderName("drawn")}
                        className="text-sm font-medium text-gray-700 bg-transparent border-none outline-none flex-1"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 flex-1">
                      <span className="text-sm font-medium text-gray-700">
                        {folderNames.drawn}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditingFolder("drawn");
                        }}
                        className="p-0.5 hover:bg-gray-200 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Rename folder"
                      >
                        <Icon
                          icon="mdi:pencil"
                          className="h-3 w-3 text-gray-400"
                        />
                      </button>
                    </div>
                  )}
                  <Icon
                    icon={
                      collapsedSections.drawn
                        ? "mdi:chevron-right"
                        : "mdi:chevron-down"
                    }
                    className="h-3 w-3 text-gray-400 ml-auto"
                  />
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="space-y-2">
                    {layers
                      .filter((layer) => !layer.isUploaded)
                      .map((layer) => (
                        <div
                          key={layer.id}
                          className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                        >
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleLayerVisibility(layer.id)}
                              className="p-1"
                            >
                              <Icon
                                icon={layer.visible ? "mdi:eye" : "mdi:eye-off"}
                                className="h-4 w-4 text-gray-600"
                              />
                            </button>
                            <Icon
                              icon={layer.icon}
                              className="h-4 w-4"
                              style={{ color: layer.color }}
                            />
                            <div className="flex items-center gap-1">
                              <span className="text-sm text-gray-700 truncate max-w-32">
                                {layer.name}
                                {layer.measurement && (
                                  <span className="ml-2 text-xs text-gray-500">
                                    {layer.measurement}
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Popover
                              open={layer.customizeOpen || false}
                              onOpenChange={(open) =>
                                setLayerCustomizeOpen(layer.id, open)
                              }
                            >
                              <PopoverTrigger asChild>
                                <button
                                  className="text-purple-500 hover:text-purple-700"
                                  title="Change color and icon"
                                >
                                  <Icon
                                    icon="mdi:palette"
                                    className="h-4 w-4"
                                  />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-80 max-h-96 overflow-y-auto">
                                <div className="space-y-4 p-1">
                                  <h4 className="font-medium">
                                    Customize Layer
                                  </h4>

                                  {/* Name Input */}
                                  <div>
                                    <label className="text-sm font-medium text-gray-700 mb-2 block">
                                      Layer Name
                                    </label>
                                    <input
                                      type="text"
                                      value={layer.name}
                                      onChange={(e) =>
                                        changeLayerName(
                                          layer.id,
                                          e.target.value
                                        )
                                      }
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                      placeholder="Enter layer name"
                                    />
                                  </div>

                                  {/* Color Picker */}
                                  <div>
                                    <label className="text-sm font-medium text-gray-700 mb-2 block">
                                      Color
                                    </label>
                                    {/* <div className="grid grid-cols-6 gap-2">
                                      {[
                                        "#ff0000",
                                        "#00ff00",
                                        "#0000ff",
                                        "#ffff00",
                                        "#ff00ff",
                                        "#00ffff",
                                        "#ff8800",
                                        "#8800ff",
                                        "#00ff88",
                                        "#ff0088",
                                        "#0088ff",
                                        "#88ff00",
                                      ].map((color) => (
                                        <button
                                          key={color}
                                          onClick={() =>
                                            changeLayerColor(layer.id, color)
                                          }
                                          className={`w-8 h-8 rounded-full border-2 ${
                                            layer.color === color
                                              ? "border-gray-800"
                                              : "border-gray-300"
                                          }`}
                                          style={{ backgroundColor: color }}
                                          title={color}
                                        />
                                      ))}
                                    </div> */}
                                    <input
                                      type="color"
                                      value={layer.color}
                                      onChange={(e) =>
                                        changeLayerColor(
                                          layer.id,
                                          e.target.value
                                        )
                                      }
                                    />
                                  </div>

                                  {/* Icon Selector */}
                                  {/* <div>
                                    <label className="text-sm font-medium text-gray-700 mb-2 block">
                                      Icon
                                    </label>
                                    <div className="grid grid-cols-6 gap-2">
                                      {[
                                        "mdi:map-marker",
                                        "mdi:map-marker-circle",
                                        "mdi:map-marker-star",
                                        "mdi:map-marker-check",
                                        "mdi:map-marker-alert",
                                        "mdi:map-marker-off",
                                        "mdi:vector-square",
                                        "mdi:vector-circle",
                                        "mdi:vector-triangle",
                                        "mdi:vector-diamond",
                                        "mdi:vector-polygon",
                                        "mdi:vector-line",
                                      ].map((icon) => (
                                        <button
                                          key={icon}
                                          onClick={() =>
                                            changeLayerIcon(layer.id, icon)
                                          }
                                          className={`w-8 h-8 rounded border-2 flex items-center justify-center ${
                                            layer.icon === icon
                                              ? "border-blue-500 bg-blue-50"
                                              : "border-gray-300"
                                          }`}
                                          title={icon}
                                        >
                                          <Icon
                                            icon={icon}
                                            className="h-4 w-4"
                                            style={{ color: layer.color }}
                                          />
                                        </button>
                                      ))}
                                    </div>
                                  </div> */}

                                  {/* Radius Control (for points only) */}
                                  {layer.type === "point" && (
                                    <div>
                                      <label className="text-sm font-medium text-gray-700 mb-2 block">
                                        Radius (pixels)
                                      </label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="range"
                                          min="4"
                                          max="32"
                                          value={layer.radius || 12}
                                          onChange={(e) =>
                                            changeLayerRadius(
                                              layer.id,
                                              parseInt(e.target.value)
                                            )
                                          }
                                          className="flex-1"
                                        />
                                        <span className="text-sm text-gray-600 w-8">
                                          {layer.radius || 12}
                                        </span>
                                      </div>
                                    </div>
                                  )}

                                  {/* Point Display Mode (for points only) */}
                                  {layer.type === "point" && (
                                    <div>
                                      <label className="text-sm font-medium text-gray-700 mb-2 block">
                                        Display Mode
                                      </label>
                                      <div className="grid grid-cols-2 gap-2">
                                        <button
                                          onClick={() =>
                                            changePointDisplayMode(
                                              layer.id,
                                              "circle"
                                            )
                                          }
                                          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 justify-center ${
                                            (layer.pointDisplayMode ||
                                              "circle") === "circle"
                                              ? "bg-blue-500 text-white"
                                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                          }`}
                                        >
                                          <Icon
                                            icon="mdi:circle"
                                            className="h-4 w-4"
                                          />
                                          Circle
                                        </button>
                                        <button
                                          onClick={() =>
                                            changePointDisplayMode(
                                              layer.id,
                                              "icon"
                                            )
                                          }
                                          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 justify-center ${
                                            (layer.pointDisplayMode ||
                                              "circle") === "icon"
                                              ? "bg-blue-500 text-white"
                                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                          }`}
                                        >
                                          <Icon
                                            icon="mdi:map-marker"
                                            className="h-4 w-4"
                                          />
                                          Icon
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </PopoverContent>
                            </Popover>

                            <button
                              onClick={() => focusOnLayer(layer.id)}
                              className="text-blue-500 hover:text-blue-700"
                              title="Focus on layer"
                            >
                              <Icon
                                icon="mdi:crosshairs-gps"
                                className="h-4 w-4"
                              />
                            </button>
                            <button
                              onClick={() => removeLayer(layer.id)}
                              className="text-red-500 hover:text-red-700"
                              title="Delete layer"
                            >
                              <Icon icon="mdi:delete" className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {/* Uploaded Section */}
          {layers.filter((layer) => layer.isUploaded).length > 0 && (
            <Collapsible
              open={!collapsedSections.uploaded}
              onOpenChange={(open) =>
                setCollapsedSections((prev) => ({ ...prev, uploaded: !open }))
              }
            >
              <div className="p-4 border-b border-gray-100">
                <CollapsibleTrigger className="group flex items-center gap-2 mb-3 w-full text-left hover:bg-gray-50 rounded p-1">
                  <Icon icon="mdi:folder" className="h-4 w-4 text-gray-500" />
                  {editingFolder === "uploaded" ? (
                    <div className="flex items-center gap-1 flex-1">
                      <input
                        type="text"
                        value={editingValue}
                        onChange={(e) => setEditingValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveFolderName("uploaded");
                          if (e.key === "Escape") cancelEditingFolder();
                        }}
                        onBlur={() => saveFolderName("uploaded")}
                        className="text-sm font-medium text-gray-700 bg-transparent border-none outline-none flex-1"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 flex-1">
                      <span className="text-sm font-medium text-gray-700">
                        {folderNames.uploaded}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          startEditingFolder("uploaded");
                        }}
                        className="p-0.5 hover:bg-gray-200 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Rename folder"
                      >
                        <Icon
                          icon="mdi:pencil"
                          className="h-3 w-3 text-gray-400"
                        />
                      </button>
                    </div>
                  )}
                  <Icon
                    icon={
                      collapsedSections.uploaded
                        ? "mdi:chevron-right"
                        : "mdi:chevron-down"
                    }
                    className="h-3 w-3 text-gray-400 ml-auto"
                  />
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="space-y-2">
                    {layers
                      .filter((layer) => layer.isUploaded)
                      .map((layer) => (
                        <div
                          key={layer.id}
                          className="flex items-center justify-between p-2 bg-gray-50 rounded-lg"
                        >
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => toggleLayerVisibility(layer.id)}
                              className="p-1"
                            >
                              <Icon
                                icon={layer.visible ? "mdi:eye" : "mdi:eye-off"}
                                className="h-4 w-4 text-gray-600"
                              />
                            </button>
                            <Icon
                              icon={layer.icon}
                              className="h-4 w-4"
                              style={{ color: layer.color }}
                            />
                            <div className="flex items-center gap-1">
                              <span className="text-sm text-gray-700 truncate max-w-32">
                                {layer.name}
                                {layer.measurement && (
                                  <span className="ml-2 text-xs text-gray-500">
                                    {layer.measurement}
                                  </span>
                                )}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Popover
                              open={layer.customizeOpen || false}
                              onOpenChange={(open) =>
                                setLayerCustomizeOpen(layer.id, open)
                              }
                            >
                              <PopoverTrigger asChild>
                                <button
                                  className="text-purple-500 hover:text-purple-700"
                                  title="Change color and icon"
                                >
                                  <Icon
                                    icon="mdi:palette"
                                    className="h-4 w-4"
                                  />
                                </button>
                              </PopoverTrigger>
                              <PopoverContent className="w-80 max-h-96 overflow-y-auto">
                                <div className="space-y-4 p-1">
                                  <h4 className="font-medium">
                                    Customize Layer
                                  </h4>

                                  {/* Name Input */}
                                  <div>
                                    <label className="text-sm font-medium text-gray-700 mb-2 block">
                                      Layer Name
                                    </label>
                                    <input
                                      type="text"
                                      value={layer.name}
                                      onChange={(e) =>
                                        changeLayerName(
                                          layer.id,
                                          e.target.value
                                        )
                                      }
                                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                                      placeholder="Enter layer name"
                                    />
                                  </div>

                                  {/* Color Picker */}
                                  <div>
                                    <label className="text-sm font-medium text-gray-700 mb-2 block">
                                      Color
                                    </label>
                                    <div className="grid grid-cols-6 gap-2">
                                      {[
                                        "#ff0000",
                                        "#00ff00",
                                        "#0000ff",
                                        "#ffff00",
                                        "#ff00ff",
                                        "#00ffff",
                                        "#ff8800",
                                        "#8800ff",
                                        "#00ff88",
                                        "#ff0088",
                                        "#0088ff",
                                        "#88ff00",
                                      ].map((color) => (
                                        <button
                                          key={color}
                                          onClick={() =>
                                            changeLayerColor(layer.id, color)
                                          }
                                          className={`w-8 h-8 rounded-full border-2 ${
                                            layer.color === color
                                              ? "border-gray-800"
                                              : "border-gray-300"
                                          }`}
                                          style={{ backgroundColor: color }}
                                          title={color}
                                        />
                                      ))}
                                    </div>
                                  </div>

                                  {/* Icon Selector */}
                                  <div>
                                    <label className="text-sm font-medium text-gray-700 mb-2 block">
                                      Icon
                                    </label>
                                    <div className="grid grid-cols-6 gap-2">
                                      {[
                                        "mdi:map-marker",
                                        "mdi:map-marker-circle",
                                        "mdi:map-marker-star",
                                        "mdi:map-marker-check",
                                        "mdi:map-marker-alert",
                                        "mdi:map-marker-off",
                                        "mdi:vector-square",
                                        "mdi:vector-circle",
                                        "mdi:vector-triangle",
                                        "mdi:vector-diamond",
                                        "mdi:vector-polygon",
                                        "mdi:vector-line",
                                      ].map((icon) => (
                                        <button
                                          key={icon}
                                          onClick={() =>
                                            changeLayerIcon(layer.id, icon)
                                          }
                                          className={`w-8 h-8 rounded border-2 flex items-center justify-center ${
                                            layer.icon === icon
                                              ? "border-blue-500 bg-blue-50"
                                              : "border-gray-300"
                                          }`}
                                          title={icon}
                                        >
                                          <Icon
                                            icon={icon}
                                            className="h-4 w-4"
                                            style={{ color: layer.color }}
                                          />
                                        </button>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Radius Control (for points only) */}
                                  {layer.type === "point" && (
                                    <div>
                                      <label className="text-sm font-medium text-gray-700 mb-2 block">
                                        Radius (pixels)
                                      </label>
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="range"
                                          min="4"
                                          max="32"
                                          value={layer.radius || 12}
                                          onChange={(e) =>
                                            changeLayerRadius(
                                              layer.id,
                                              parseInt(e.target.value)
                                            )
                                          }
                                          className="flex-1"
                                        />
                                        <span className="text-sm text-gray-600 w-8">
                                          {layer.radius || 12}
                                        </span>
                                      </div>
                                    </div>
                                  )}

                                  {/* Point Display Mode (for points only) */}
                                  {layer.type === "point" && (
                                    <div>
                                      <label className="text-sm font-medium text-gray-700 mb-2 block">
                                        Display Mode
                                      </label>
                                      <div className="grid grid-cols-2 gap-2">
                                        <button
                                          onClick={() =>
                                            changePointDisplayMode(
                                              layer.id,
                                              "circle"
                                            )
                                          }
                                          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 justify-center ${
                                            (layer.pointDisplayMode ||
                                              "circle") === "circle"
                                              ? "bg-blue-500 text-white"
                                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                          }`}
                                        >
                                          <Icon
                                            icon="mdi:circle"
                                            className="h-4 w-4"
                                          />
                                          Circle
                                        </button>
                                        <button
                                          onClick={() =>
                                            changePointDisplayMode(
                                              layer.id,
                                              "icon"
                                            )
                                          }
                                          className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 justify-center ${
                                            (layer.pointDisplayMode ||
                                              "circle") === "icon"
                                              ? "bg-blue-500 text-white"
                                              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                          }`}
                                        >
                                          <Icon
                                            icon="mdi:map-marker"
                                            className="h-4 w-4"
                                          />
                                          Icon
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </PopoverContent>
                            </Popover>

                            <button
                              onClick={() => focusOnLayer(layer.id)}
                              className="text-blue-500 hover:text-blue-700"
                              title="Focus on layer"
                            >
                              <Icon
                                icon="mdi:crosshairs-gps"
                                className="h-4 w-4"
                              />
                            </button>
                            <button
                              onClick={() => removeLayer(layer.id)}
                              className="text-red-500 hover:text-red-700"
                              title="Delete layer"
                            >
                              <Icon icon="mdi:delete" className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {/* Network Nodes Section */}
          {networkNodesLayer && (
            <Collapsible
              open={!collapsedSections.network}
              onOpenChange={(open) =>
                setCollapsedSections((prev) => ({ ...prev, network: !open }))
              }
            >
              <div className="p-4 border-b border-gray-100">
                <CollapsibleTrigger className="group flex items-center gap-2 mb-3 w-full text-left hover:bg-gray-50 rounded p-1">
                  <Icon icon="mdi:network" className="h-4 w-4 text-gray-500" />
                  <span className="text-sm font-medium text-gray-700">
                    Network Nodes
                  </span>
                  <Icon
                    icon={
                      collapsedSections.network
                        ? "mdi:chevron-right"
                        : "mdi:chevron-down"
                    }
                    className="h-3 w-3 text-gray-400 ml-auto"
                  />
                </CollapsibleTrigger>

                <CollapsibleContent>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setNetworkLayerState((prev) => ({
                              ...prev,
                              visible: !prev.visible,
                            }));
                          }}
                          className="p-1"
                        >
                          <Icon
                            icon={
                              networkLayerState.visible
                                ? "mdi:eye"
                                : "mdi:eye-off"
                            }
                            className="h-4 w-4 text-gray-600"
                          />
                        </button>
                        <Icon
                          icon={networkNodesLayer?.icon || "mdi:map-marker"}
                          className="h-4 w-4"
                          style={{ color: networkNodesLayer?.color }}
                        />
                        <span className="text-sm text-gray-700 truncate max-w-32">
                          {networkNodesLayer?.name}
                          <span className="ml-2 text-xs text-gray-500">
                            ({Array.isArray(socketData) ? socketData.length : 0}{" "}
                            nodes)
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              className="text-purple-500 hover:text-purple-700"
                              title="Customize network nodes"
                            >
                              <Icon icon="mdi:palette" className="h-4 w-4" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent className="w-80 max-h-96 overflow-y-auto">
                            <div className="space-y-4 p-1">
                              <h4 className="font-medium">
                                Customize Network Nodes
                              </h4>
                              <p className="text-xs text-gray-500 mb-3">
                                Colors are automatically set based on signal
                                quality (SNR)
                              </p>

                              {/* Radius Control */}
                              <div>
                                <label className="text-sm font-medium text-gray-700 mb-2 block">
                                  Radius (pixels)
                                </label>
                                <div className="flex items-center gap-2">
                                  <input
                                    type="range"
                                    min="4"
                                    max="32"
                                    value={networkLayerState.radius}
                                    onChange={(e) => {
                                      setNetworkLayerState((prev) => ({
                                        ...prev,
                                        radius: parseInt(e.target.value),
                                      }));
                                    }}
                                    className="flex-1"
                                  />
                                  <span className="text-sm text-gray-600 w-8">
                                    {networkLayerState.radius}
                                  </span>
                                </div>
                              </div>

                              {/* Point Display Mode */}
                              <div>
                                <label className="text-sm font-medium text-gray-700 mb-2 block">
                                  Display Mode
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                  <button
                                    onClick={() => {
                                      setNetworkLayerState((prev) => ({
                                        ...prev,
                                        pointDisplayMode: "circle",
                                      }));
                                    }}
                                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 justify-center ${
                                      networkLayerState.pointDisplayMode ===
                                      "circle"
                                        ? "bg-blue-500 text-white"
                                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    }`}
                                  >
                                    <Icon
                                      icon="mdi:circle"
                                      className="h-4 w-4"
                                    />
                                    Circle
                                  </button>
                                  <button
                                    onClick={() => {
                                      setNetworkLayerState((prev) => ({
                                        ...prev,
                                        pointDisplayMode: "icon",
                                      }));
                                    }}
                                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 justify-center ${
                                      networkLayerState.pointDisplayMode ===
                                      "icon"
                                        ? "bg-blue-500 text-white"
                                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                    }`}
                                  >
                                    <Icon
                                      icon="mdi:map-marker"
                                      className="h-4 w-4"
                                    />
                                    Icon
                                  </button>
                                </div>
                              </div>

                              {/* Icon Type Selection (for icon mode only) */}
                              {networkLayerState.pointDisplayMode ===
                                "icon" && (
                                <div>
                                  <label className="text-sm font-medium text-gray-700 mb-2 block">
                                    Icon Type
                                  </label>
                                  <div className="grid grid-cols-2 gap-2">
                                    <button
                                      onClick={() => {
                                        setNetworkLayerState((prev) => ({
                                          ...prev,
                                          iconType: "marker",
                                        }));
                                      }}
                                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 justify-center ${
                                        networkLayerState.iconType === "marker"
                                          ? "bg-green-500 text-white"
                                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                      }`}
                                    >
                                      <Icon
                                        icon="mdi:map-marker"
                                        className="h-4 w-4"
                                      />
                                      Marker
                                    </button>
                                    <button
                                      onClick={() => {
                                        setNetworkLayerState((prev) => ({
                                          ...prev,
                                          iconType: "pin",
                                        }));
                                      }}
                                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 justify-center ${
                                        networkLayerState.iconType === "pin"
                                          ? "bg-green-500 text-white"
                                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                      }`}
                                    >
                                      <Icon
                                        icon="mdi:map-pin"
                                        className="h-4 w-4"
                                      />
                                      Pin
                                    </button>
                                    <button
                                      onClick={() => {
                                        setNetworkLayerState((prev) => ({
                                          ...prev,
                                          iconType: "wifi",
                                        }));
                                      }}
                                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 justify-center ${
                                        networkLayerState.iconType === "wifi"
                                          ? "bg-green-500 text-white"
                                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                      }`}
                                    >
                                      <Icon
                                        icon="mdi:wifi"
                                        className="h-4 w-4"
                                      />
                                      WiFi
                                    </button>
                                    <button
                                      onClick={() => {
                                        setNetworkLayerState((prev) => ({
                                          ...prev,
                                          iconType: "circle",
                                        }));
                                      }}
                                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 justify-center ${
                                        networkLayerState.iconType === "circle"
                                          ? "bg-green-500 text-white"
                                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                                      }`}
                                    >
                                      <Icon
                                        icon="mdi:circle"
                                        className="h-4 w-4"
                                      />
                                      Circle
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>
          )}

          {/* Drawing Tools Section */}
          <Collapsible
            open={!collapsedSections.tools}
            onOpenChange={(open) =>
              setCollapsedSections((prev) => ({ ...prev, tools: !open }))
            }
          >
            <div className="p-4 border-b border-gray-100">
              <CollapsibleTrigger className="group flex items-center gap-2 mb-3 w-full text-left hover:bg-gray-50 rounded p-1">
                <Icon icon="mdi:folder" className="h-4 w-4 text-gray-500" />
                {editingFolder === "tools" ? (
                  <div className="flex items-center gap-1 flex-1">
                    <input
                      type="text"
                      value={editingValue}
                      onChange={(e) => setEditingValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveFolderName("tools");
                        if (e.key === "Escape") cancelEditingFolder();
                      }}
                      onBlur={() => saveFolderName("tools")}
                      className="text-sm font-medium text-gray-700 bg-transparent border-none outline-none flex-1"
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="flex items-center gap-1 flex-1">
                    <span className="text-sm font-medium text-gray-700">
                      {folderNames.tools}
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditingFolder("tools");
                      }}
                      className="p-0.5 hover:bg-gray-200 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Rename folder"
                    >
                      <Icon
                        icon="mdi:pencil"
                        className="h-3 w-3 text-gray-400"
                      />
                    </button>
                  </div>
                )}
                <Icon
                  icon={
                    collapsedSections.tools
                      ? "mdi:chevron-right"
                      : "mdi:chevron-down"
                  }
                  className="h-3 w-3 text-gray-400 ml-auto"
                />
              </CollapsibleTrigger>

              <CollapsibleContent>
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-2">
                    <button
                      onClick={() =>
                        setDrawMode(drawMode === "point" ? "none" : "point")
                      }
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        drawMode === "point"
                          ? "bg-blue-500 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      <Icon
                        icon="mdi:map-marker"
                        className="h-4 w-4 inline mr-1"
                      />
                      Point
                    </button>
                    <button
                      onClick={() =>
                        setDrawMode(drawMode === "polygon" ? "none" : "polygon")
                      }
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        drawMode === "polygon"
                          ? "bg-blue-500 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      <Icon
                        icon="mdi:vector-square"
                        className="h-4 w-4 inline mr-1"
                      />
                      Polygon
                    </button>
                    <button
                      onClick={() =>
                        setDrawMode(drawMode === "line" ? "none" : "line")
                      }
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        drawMode === "line"
                          ? "bg-blue-500 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      <Icon
                        icon="mdi:vector-line"
                        className="h-4 w-4 inline mr-1"
                      />
                      Line
                    </button>
                    <button
                      onClick={() =>
                        setDrawMode(drawMode === "sector" ? "none" : "sector")
                      }
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        drawMode === "sector"
                          ? "bg-blue-500 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      <Icon
                        icon="mdi:pie-chart"
                        className="h-4 w-4 inline mr-1"
                      />
                      Sector
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() =>
                        setDrawMode(
                          drawMode === "distance" ? "none" : "distance"
                        )
                      }
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        drawMode === "distance"
                          ? "bg-green-500 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      <Icon icon="mdi:ruler" className="h-4 w-4 inline mr-1" />
                      Distance
                    </button>
                    <button
                      onClick={() =>
                        setDrawMode(drawMode === "area" ? "none" : "area")
                      }
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        drawMode === "area"
                          ? "bg-green-500 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      <Icon
                        icon="mdi:vector-square"
                        className="h-4 w-4 inline mr-1"
                      />
                      Area
                    </button>
                    {/* <button
                      onClick={() =>
                        setDrawMode(drawMode === "azimuth" ? "none" : "azimuth")
                      }
                      className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        drawMode === "azimuth"
                          ? "bg-green-500 text-white"
                          : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                      }`}
                    >
                      <Icon
                        icon="mdi:compass"
                        className="h-4 w-4 inline mr-1"
                      />
                      Azimuth
                    </button> */}
                  </div>
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>

          {/* Map Style Selector */}
          <div className="p-4 border-b border-gray-100">
            <h3 className="text-sm font-medium text-gray-700 mb-3">
              Map Style
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() =>
                  setMapStyle("mapbox://styles/mapbox/streets-v12")
                }
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mapStyle === "mapbox://styles/mapbox/streets-v12"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <Icon icon="mdi:map" className="h-4 w-4 inline mr-1" />
                Streets
              </button>
              <button
                onClick={() =>
                  setMapStyle("mapbox://styles/mapbox/satellite-v9")
                }
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mapStyle === "mapbox://styles/mapbox/satellite-v9"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <Icon
                  icon="mdi:satellite-variant"
                  className="h-4 w-4 inline mr-1"
                />
                Satellite
              </button>
              <button
                onClick={() => setMapStyle("mapbox://styles/mapbox/light-v11")}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mapStyle === "mapbox://styles/mapbox/light-v11"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <Icon
                  icon="mdi:white-balance-sunny"
                  className="h-4 w-4 inline mr-1"
                />
                Light
              </button>
              <button
                onClick={() => setMapStyle("mapbox://styles/mapbox/dark-v11")}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  mapStyle === "mapbox://styles/mapbox/dark-v11"
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                <Icon
                  icon="mdi:weather-night"
                  className="h-4 w-4 inline mr-1"
                />
                Dark
              </button>
            </div>
          </div>

          {/* Drawing Instructions */}
          {drawMode !== "none" && (
            <div className="p-4 bg-blue-50 border-t border-gray-100">
              <p className="text-sm text-blue-700">
                {drawMode === "point"
                  ? "Click on the map to add a point"
                  : drawMode === "polygon"
                  ? "Click on the map to add polygon vertices. Click near the first point (highlighted in green) to close the polygon."
                  : drawMode === "line"
                  ? "Click two points to draw a line"
                  : drawMode === "sector"
                  ? "Click to set center, then radius, then start angle, then end angle for sector."
                  : drawMode === "distance"
                  ? "Click two points to measure distance"
                  : drawMode === "area"
                  ? "Click to add polygon vertices. Click near the first point to close and calculate area."
                  : drawMode === "azimuth"
                  ? "Click two points to measure azimuth (bearing)"
                  : ""}
              </p>
            </div>
          )}

          {/* Cancel Drawing Button */}
          {(drawMode === "polygon" && drawingPoints.length > 0) ||
          (drawMode === "line" && drawingPoints.length > 0) ||
          (drawMode === "sector" && (sectorCenter || sectorRadius > 0)) ||
          (drawMode === "distance" && drawingPoints.length > 0) ||
          (drawMode === "area" && drawingPoints.length > 0) ||
          (drawMode === "azimuth" && drawingPoints.length > 0) ? (
            <div className="p-4 border-t border-gray-100">
              <button
                onClick={() => {
                  setDrawingPoints([]);
                  setSectorCenter(null);
                  setSectorRadius(0);
                  setSectorStartAngle(0);
                  setMousePosition(null);
                  setDrawMode("none");
                }}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Cancel drawing
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* Map Scale Display */}
      <div className="absolute bottom-4 left-4 bg-white bg-opacity-90 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 p-2">
        <div className="text-xs text-gray-700 font-medium">
          Scale: 1:
          {Math.round(
            (156543.03392 * Math.cos((viewState.latitude * Math.PI) / 180)) /
              Math.pow(2, viewState.zoom)
          )}
        </div>
        <div className="text-xs text-gray-500">
          Zoom: {viewState.zoom.toFixed(1)}
        </div>
      </div>

      {/* WGS84 Watermark */}
      <div className="absolute bottom-2 left-2 text-sm text-white font-bold bg-black bg-opacity-50 px-2 py-1 rounded shadow-lg">
        WGS84
      </div>

      {/* Compass Control */}
      <div className="absolute bottom-4 right-4 bg-white bg-opacity-90 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 p-2">
        <div className="flex flex-col items-center">
          <button
            onClick={() => {
              setViewState((prev) => ({
                ...prev,
                bearing: 0,
              }));
            }}
            className="w-12 h-12 rounded-full bg-white border-2 border-gray-300 hover:border-gray-400 transition-colors flex items-center justify-center relative"
            title="Reset to North"
          >
            <Icon
              icon="mdi:compass"
              className="h-6 w-6 text-gray-700"
              style={{
                transform: `rotate(${-viewState.bearing}deg)`,
                transition: "transform 0.3s ease",
              }}
            />
            <div
              className="absolute top-0 left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-red-500"
              style={{
                transform: `translateX(-50%) rotate(${-viewState.bearing}deg)`,
                transition: "transform 0.3s ease",
              }}
            />
          </button>
          <div className="text-xs text-gray-600 mt-1">
            {Math.abs(viewState.bearing).toFixed(0)}°
          </div>
        </div>
      </div>

      {/* Tilt Controls */}
      <div className="absolute bottom-4 right-20 bg-white bg-opacity-90 backdrop-blur-sm rounded-lg shadow-lg border border-gray-200 p-2">
        <div className="flex flex-col items-center space-y-1">
          <button
            onClick={() => {
              setViewState((prev) => ({
                ...prev,
                pitch: Math.min(60, prev.pitch + 15),
              }));
            }}
            className="w-8 h-8 bg-blue-500 hover:bg-blue-600 text-white rounded flex items-center justify-center transition-colors"
            title="Tilt Up"
          >
            <Icon icon="mdi:chevron-up" className="h-4 w-4" />
          </button>

          <div className="text-xs text-gray-600 font-medium">
            {viewState.pitch.toFixed(0)}°
          </div>

          <button
            onClick={() => {
              setViewState((prev) => ({
                ...prev,
                pitch: Math.max(0, prev.pitch - 15),
              }));
            }}
            className="w-8 h-8 bg-blue-500 hover:bg-blue-600 text-white rounded flex items-center justify-center transition-colors"
            title="Tilt Down"
          >
            <Icon icon="mdi:chevron-down" className="h-4 w-4" />
          </button>

          <button
            onClick={() => {
              setViewState((prev) => ({
                ...prev,
                pitch: 0,
              }));
            }}
            className="w-8 h-8 bg-gray-500 hover:bg-gray-600 text-white rounded flex items-center justify-center transition-colors text-xs"
            title="Reset Tilt"
          >
            0°
          </button>
        </div>
      </div>
    </div>
  );
};

// Helper function to convert hex color to RGB array
function hexToRgb(hex: string): [number, number, number] {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16),
      ]
    : [0, 0, 0];
}

// Helper function to convert map coordinates to screen coordinates
const mapToScreen = (lng: number, lat: number): [number, number] => {
  // This is a simplified conversion - in a real implementation you'd use the map's projection
  const x = ((lng + 180) / 360) * window.innerWidth;
  const y = ((90 - lat) / 180) * window.innerHeight;
  return [x, y];
};

export default App;
