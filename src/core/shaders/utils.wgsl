// src/core/shaders/utils.wgsl

/**
 * Calculates the inverse of a 3x3 matrix.
 *
 * @param m The 3x3 matrix to invert.
 * @returns The inverted 3x3 matrix.
 */
fn mat3_inverse(m: mat3x3<f32>) -> mat3x3<f32> {
    let c00 = m[1][1] * m[2][2] - m[2][1] * m[1][2];
    let c01 = m[0][2] * m[2][1] - m[0][1] * m[2][2];
    let c02 = m[0][1] * m[1][2] - m[0][2] * m[1][1];

    let c10 = m[1][2] * m[2][0] - m[1][0] * m[2][2];
    let c11 = m[0][0] * m[2][2] - m[0][2] * m[2][0];
    let c12 = m[1][0] * m[0][2] - m[0][0] * m[1][2];

    let c20 = m[1][0] * m[2][1] - m[2][0] * m[1][1];
    let c21 = m[2][0] * m[0][1] - m[0][0] * m[2][1];
    let c22 = m[0][0] * m[1][1] - m[1][0] * m[0][1];

    let det = m[0][0]*c00 + m[1][0]*c01 + m[2][0]*c02;
    if (det == 0.0) { return mat3x3<f32>(); }


    let adj = mat3x3<f32>(
        c00, c01, c02,
        c10, c11, c12,
        c20, c21, c22
    );

    return (1.0 / det) * adj;
}

/**
 * Calculates the inverse of a 4x4 matrix.
 *
 * @param m The 4x4 matrix to invert.
 * @returns The inverted 4x4 matrix.
 */
fn mat4_inverse(m: mat4x4<f32>) -> mat4x4<f32> {
    let m00 = m[0][0]; let m01 = m[0][1]; let m02 = m[0][2]; let m03 = m[0][3];
    let m10 = m[1][0]; let m11 = m[1][1]; let m12 = m[1][2]; let m13 = m[1][3];
    let m20 = m[2][0]; let m21 = m[2][1]; let m22 = m[2][2]; let m23 = m[2][3];
    let m30 = m[3][0]; let m31 = m[3][1]; let m32 = m[3][2]; let m33 = m[3][3];

    let b00 = m00 * m11 - m01 * m10;
    let b01 = m00 * m12 - m02 * m10;
    let b02 = m00 * m13 - m03 * m10;
    let b03 = m01 * m12 - m02 * m11;
    let b04 = m01 * m13 - m03 * m11;
    let b05 = m02 * m13 - m03 * m12;
    let b06 = m20 * m31 - m21 * m30;
    let b07 = m20 * m32 - m22 * m30;
    let b08 = m20 * m33 - m23 * m30;
    let b09 = m21 * m32 - m22 * m31;
    let b10 = m21 * m33 - m23 * m31;
    let b11 = m22 * m33 - m23 * m32;

    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (det == 0.0) { return mat4x4<f32>(); }
    let invDet = 1.0 / det;

    var result: mat4x4<f32>;
    result[0][0] = (m11 * b11 - m12 * b10 + m13 * b09) * invDet;
    result[0][1] = (-m01 * b11 + m02 * b10 - m03 * b09) * invDet;
    result[0][2] = (m31 * b05 - m32 * b04 + m33 * b03) * invDet;
    result[0][3] = (-m21 * b05 + m22 * b04 - m23 * b03) * invDet;
    result[1][0] = (-m10 * b11 + m12 * b08 - m13 * b07) * invDet;
    result[1][1] = (m00 * b11 - m02 * b08 + m03 * b07) * invDet;
    result[1][2] = (-m30 * b05 + m32 * b02 - m33 * b01) * invDet;
    result[1][3] = (m20 * b05 - m22 * b02 + m23 * b01) * invDet;
    result[2][0] = (m10 * b10 - m11 * b08 + m13 * b06) * invDet;
    result[2][1] = (-m00 * b10 + m01 * b08 - m03 * b06) * invDet;
    result[2][2] = (m30 * b04 - m31 * b02 + m33 * b00) * invDet;
    result[2][3] = (-m20 * b04 + m21 * b02 - m23 * b00) * invDet;
    result[3][0] = (-m10 * b09 + m11 * b07 - m12 * b06) * invDet;
    result[3][1] = (m00 * b09 - m01 * b07 + m02 * b06) * invDet;
    result[3][2] = (-m30 * b03 + m31 * b01 - m32 * b00) * invDet;
    result[3][3] = (m20 * b03 - m21 * b01 + m22 * b00) * invDet;

    return result;
}

/**
 * ACES Filmic Tone Mapping Curve. A widely used and effective curve 
 * for converting HDR to SDR.
 *
 * @params color The HDR color vector
 * @returns The SDR color vector
 */ 
fn ACESFilmicToneMapping(color: vec3<f32>) -> vec3<f32> {
    let a = 2.51;
    let b = 0.03;
    let c = 2.43;
    let d = 0.59;
    let e = 0.14;
    let numerator = color * (a * color + b);
    let denominator = color * (c * color + d) + e;
    return clamp(numerator / denominator, vec3<f32>(0.0), vec3<f32>(1.0));
}
