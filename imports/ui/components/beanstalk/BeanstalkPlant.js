/**
 * BeanstalkPlant.js - Procedural plant geometry for Babylon.js
 * Based on the original implementation by inear
 */

import * as BABYLON from '@babylonjs/core';

const PI2 = Math.PI * 2;
const BRANCH_SEGMENTS = 10;

export class BeanstalkPlant {
  constructor(scene, material, radius) {
    this.scene = scene;
    this.material = material;
    this.radius = radius;
    this.initialRadius = radius;

    this.totalLinks = 90;
    this.linkDist = 20;

    // Ring data arrays
    this.ring = new Array(this.totalLinks);
    this.ringOrigin = new Array(this.totalLinks);
    this.offsetPoints = new Array(this.totalLinks);

    // Create the mesh
    this.mesh = new BABYLON.Mesh('plant', scene);
    this.mesh.material = material;

    // Vertex data
    this.positions = null;
    this.normals = null;
    this.uvs = null;
    this.indices = null;

    // For tracking current build position
    this.numCurrentPos = 0;

    // Build parameters
    this.segmentAngle = PI2 / BRANCH_SEGMENTS;
    this.radiusStep = this.radius / this.totalLinks;

    // R and S vectors for ring positioning
    this.R = new BABYLON.Vector3();
    this.S = new BABYLON.Vector3();

    // Base and branch points
    this.basePoint = new BABYLON.Vector3(0, 0, 0);
    this.branchPoint = new BABYLON.Vector3(0, 0, -50);
  }

  build() {
    // Calculate total vertices and faces
    const totalVertices = this.totalLinks * BRANCH_SEGMENTS;
    const totalFaces = (this.totalLinks - 1) * BRANCH_SEGMENTS * 2;

    // Initialize arrays
    this.positions = new Float32Array(totalVertices * 3);
    this.normals = new Float32Array(totalVertices * 3);
    this.uvs = new Float32Array(totalVertices * 2);
    this.indices = new Uint32Array(totalFaces * 3);

    // Reset
    this.numCurrentPos = 0;
    this.radius = this.initialRadius;
    this.basePoint.set(0, 0, 0);
    this.branchPoint.set(0, 0, -50);

    let indexOffset = 0;

    // Build each segment
    for (let segmentNum = 0; segmentNum < this.totalLinks; segmentNum++) {
      // Store last point
      this.basePoint.copyFrom(this.branchPoint);

      // Move forward
      this.branchPoint.z += this.linkDist;

      // Decrease radius
      this.radius -= this.radiusStep;

      // Calculate difference vector
      const diffVector = this.branchPoint.subtract(this.basePoint);

      // Transform point for R calculation
      const transformPoint = diffVector.add(new BABYLON.Vector3(10, 0, 0));

      // Calculate R and S vectors (perpendicular to direction)
      BABYLON.Vector3.CrossToRef(transformPoint, diffVector, this.R);
      BABYLON.Vector3.CrossToRef(this.R, diffVector, this.S);

      this.R.normalize();
      this.S.normalize();

      // Build ring vertices
      const bFirstNode = this.numCurrentPos === 0;
      const transformedRadius = Math.max(this.radius, 1);

      this.offsetPoints[this.numCurrentPos] = new BABYLON.Vector3(0, 0, 0);
      this.ring[this.numCurrentPos] = new Array(BRANCH_SEGMENTS);
      this.ringOrigin[this.numCurrentPos] = new Array(BRANCH_SEGMENTS);

      for (let vertexIndex = 0; vertexIndex < BRANCH_SEGMENTS; vertexIndex++) {
        const angle = vertexIndex * this.segmentAngle;
        const cosAngle = Math.cos(angle);
        const sinAngle = Math.sin(angle);

        const pX = this.basePoint.x + transformedRadius * cosAngle * this.R.x + transformedRadius * sinAngle * this.S.x;
        const pY = this.basePoint.y + transformedRadius * cosAngle * this.R.y + transformedRadius * sinAngle * this.S.y;
        const pZ = this.basePoint.z + transformedRadius * cosAngle * this.R.z + transformedRadius * sinAngle * this.S.z;

        const idx = (this.numCurrentPos * BRANCH_SEGMENTS + vertexIndex) * 3;
        this.positions[idx] = pX;
        this.positions[idx + 1] = pY;
        this.positions[idx + 2] = pZ;

        // Store ring vertex positions
        this.ring[this.numCurrentPos][vertexIndex] = new BABYLON.Vector3(pX, pY, pZ);
        this.ringOrigin[this.numCurrentPos][vertexIndex] = new BABYLON.Vector3(pX, pY, pZ);

        // UVs
        const uvIdx = (this.numCurrentPos * BRANCH_SEGMENTS + vertexIndex) * 2;
        this.uvs[uvIdx] = vertexIndex / BRANCH_SEGMENTS;
        this.uvs[uvIdx + 1] = this.numCurrentPos / this.totalLinks;
      }

      // Build faces (except for first ring)
      if (!bFirstNode) {
        for (let vertexIndex = 0; vertexIndex < BRANCH_SEGMENTS; vertexIndex++) {
          const currentRingStart = this.numCurrentPos * BRANCH_SEGMENTS;
          const prevRingStart = (this.numCurrentPos - 1) * BRANCH_SEGMENTS;

          let p1, p2, p3, p4;

          if (vertexIndex < BRANCH_SEGMENTS - 1) {
            p1 = currentRingStart + vertexIndex + 1;
            p4 = currentRingStart + vertexIndex;
            p2 = prevRingStart + vertexIndex + 1;
            p3 = prevRingStart + vertexIndex;
          } else {
            p1 = currentRingStart;
            p4 = currentRingStart + vertexIndex;
            p2 = prevRingStart;
            p3 = prevRingStart + vertexIndex;
          }

          // Two triangles for the quad
          this.indices[indexOffset++] = p1;
          this.indices[indexOffset++] = p2;
          this.indices[indexOffset++] = p3;

          this.indices[indexOffset++] = p1;
          this.indices[indexOffset++] = p3;
          this.indices[indexOffset++] = p4;
        }
      }

      this.numCurrentPos++;
    }

    // Apply vertex data to mesh
    const vertexData = new BABYLON.VertexData();
    vertexData.positions = this.positions;
    vertexData.uvs = this.uvs;
    vertexData.indices = this.indices;

    // Compute normals
    BABYLON.VertexData.ComputeNormals(this.positions, this.indices, this.normals);
    vertexData.normals = this.normals;

    vertexData.applyToMesh(this.mesh, true);
  }

  updateVertices() {
    // Update positions from ring data
    for (let ringIndex = 0; ringIndex < this.totalLinks; ringIndex++) {
      for (let vertexIndex = 0; vertexIndex < BRANCH_SEGMENTS; vertexIndex++) {
        const idx = (ringIndex * BRANCH_SEGMENTS + vertexIndex) * 3;
        this.positions[idx] = this.ring[ringIndex][vertexIndex].x;
        this.positions[idx + 1] = this.ring[ringIndex][vertexIndex].y;
        this.positions[idx + 2] = this.ring[ringIndex][vertexIndex].z;
      }
    }

    // Update the mesh
    this.mesh.updateVerticesData(BABYLON.VertexBuffer.PositionKind, this.positions);

    // Recompute normals for better lighting
    BABYLON.VertexData.ComputeNormals(this.positions, this.indices, this.normals);
    this.mesh.updateVerticesData(BABYLON.VertexBuffer.NormalKind, this.normals);
  }

  addChild(mesh) {
    mesh.parent = this.mesh;
  }

  removeChild(mesh) {
    mesh.parent = null;
  }

  get position() {
    return this.mesh.position;
  }

  get rotation() {
    return this.mesh.rotation;
  }

  dispose() {
    this.mesh.dispose();
  }
}
