import unittest

from threejson_agent.texture_python import list_texture_pointers


class TexturePointerTests(unittest.TestCase):
    def test_lists_material_texture_url(self):
        scene = {
            "worldInfo": {
                "boxModelList": [
                    {"material": {"textureUrl": "/assets/textures/a.png"}}
                ]
            }
        }
        pointers = list_texture_pointers(scene)
        self.assertEqual(
            pointers, ["/worldInfo/boxModelList/0/material/textureUrl"]
        )


if __name__ == "__main__":
    unittest.main()
