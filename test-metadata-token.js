// Test function to check metadata server token
export async function testMetadataToken(req, res) {
  res.set("Access-Control-Allow-Origin", "*");
  
  try {
    console.log("Fetching token from metadata server...");
    
    const metadataRes = await fetch(
      "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
      {
        headers: { "Metadata-Flavor": "Google" }
      }
    );
    
    if (!metadataRes.ok) {
      const errorText = await metadataRes.text();
      throw new Error(`Metadata server failed: ${metadataRes.status} - ${errorText}`);
    }
    
    const tokenData = await metadataRes.json();
    console.log("Token data:", {
      hasAccessToken: !!tokenData.access_token,
      tokenLength: tokenData.access_token?.length || 0,
      expiresIn: tokenData.expires_in,
      tokenType: tokenData.token_type
    });
    
    // Try Firestore API
    const projectId = process.env.GOOGLE_CLOUD_PROJECT;
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/iatse927_messages?pageSize=1`;
    
    console.log(`Testing Firestore API: ${firestoreUrl}`);
    
    const firestoreRes = await fetch(firestoreUrl, {
      headers: {
        'Authorization': `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const firestoreBody = await firestoreRes.text();
    
    res.status(200).json({
      success: firestoreRes.ok,
      metadata: {
        hasToken: !!tokenData.access_token,
        tokenLength: tokenData.access_token?.length || 0,
        tokenPrefix: tokenData.access_token?.substring(0, 20) || '',
        expiresIn: tokenData.expires_in,
        tokenType: tokenData.token_type
      },
      firestore: {
        status: firestoreRes.status,
        statusText: firestoreRes.statusText,
        body: firestoreBody.substring(0, 1000)
      }
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
}
