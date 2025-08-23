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

    let adj = mat3x3<f32>(
        c00, c01, c02,
        c10, c11, c12,
        c20, c21, c22
    );

    return (1.0 / det) * adj;
}
