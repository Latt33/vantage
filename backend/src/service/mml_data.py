import os
import httpx
from dotenv import load_dotenv

load_dotenv()

MML_API_KEY = os.getenv("MML_API_KEY")
BASE_URL = "https://avoin-paikkatieto.maanmittauslaitos.fi/maastotiedot/features/v1"

async def fetch_mml_collections() -> dict:
    """Fetch the available data collections from Maanmittauslaitos."""
    if not MML_API_KEY:
        return {"error": "MML_API_KEY is not set in the environment"}
    
    # Maanmittauslaitos requires the API key to be passed as Basic Auth username (with empty password)
    auth = (MML_API_KEY, "")
    
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(f"{BASE_URL}/collections", auth=auth)
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            return {"error": f"HTTP error occurred: {e.response.status_code} - {e.response.text}"}
        except Exception as e:
            return {"error": f"An error occurred: {str(e)}"}
